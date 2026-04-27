import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Prefer the public Let's Encrypt wildcard cert for *.spreadsheetcoder.com
// (shared with remote-code at /etc/remote-code/). Browsers trust it out of the
// box — no CA install needed on tablets/phones. The home router resolves
// *.spreadsheetcoder.com to 192.168.68.69, so you can reach vite at e.g.
// https://rc.spreadsheetcoder.com:3001/ (or any subdomain covered by the
// wildcard).
//
// Falls back to the mkcert cert for 192.168.68.69 (trusted only on machines
// that have ~/ward/rootCA.pem installed), and finally to basic-ssl's
// self-signed cert if neither is available.
const LE_CERT = '/etc/remote-code/fullchain.pem';
const LE_KEY = '/etc/remote-code/privkey.pem';
const hasLE = fs.existsSync(LE_CERT) && fs.existsSync(LE_KEY);

const MKCERT_DIR = path.resolve(process.env.HOME || '', 'ward');
const MKCERT_CERT = path.join(MKCERT_DIR, '192.168.68.69+2.pem');
const MKCERT_KEY = path.join(MKCERT_DIR, '192.168.68.69+2-key.pem');
const hasMkcert = fs.existsSync(MKCERT_CERT) && fs.existsSync(MKCERT_KEY);

const devCert = hasLE ? { cert: fs.readFileSync(LE_CERT), key: fs.readFileSync(LE_KEY) }
              : hasMkcert ? { cert: fs.readFileSync(MKCERT_CERT), key: fs.readFileSync(MKCERT_KEY) }
              : null;

/**
 * Dev-only plugin: serves example zips from function-workshop/examples/ at /examples/
 * so the app can fetch and import example packs during development.
 */
function serveExamplePacks() {
  return {
    name: 'serve-example-packs',
    configureServer(server) {
      server.middlewares.use('/examples', (req, res, next) => {
        const examplesDir = path.resolve(__dirname, 'function-workshop', 'examples');
        const personalDir = path.resolve(__dirname, 'function-workshop', 'personal');

        // Serve the public catalog
        if (req.url === '/catalog.json') {
          const catalogPath = path.resolve(examplesDir, 'catalog.json');
          if (!fs.existsSync(catalogPath)) {
            res.statusCode = 404;
            res.end('No catalog.json found.');
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          fs.createReadStream(catalogPath).pipe(res);
          return;
        }

        // Serve the optional personal catalog (machine-local, gitignored)
        if (req.url === '/catalog-personal.json') {
          const catalogPath = path.resolve(personalDir, 'catalog.json');
          if (!fs.existsSync(catalogPath)) {
            res.statusCode = 404;
            res.end('No personal catalog.');
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          fs.createReadStream(catalogPath).pipe(res);
          return;
        }

        // Serve .zip files (check examples first, then personal as fallback)
        const fileName = decodeURIComponent(req.url.replace(/^\//, ''));
        if (!fileName.endsWith('.zip') || fileName.includes('..')) {
          return next();
        }
        let filePath = path.resolve(examplesDir, fileName);
        if (!fs.existsSync(filePath)) {
          filePath = path.resolve(personalDir, fileName);
        }
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Example not found.');
          return;
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        fs.createReadStream(filePath).pipe(res);
      });
    }
  };
}

/**
 * Dev-only plugin: serves the last production build at /__export/index.html
 * so that HTML export can embed a self-contained app bundle during development.
 */
function serveExportBuild() {
  return {
    name: 'serve-export-build',
    configureServer(server) {
      server.middlewares.use('/__export', (req, res, next) => {
        if (req.url !== '/index.html') return next();
        const distPath = path.resolve(__dirname, 'dist', 'export', 'index.html');
        if (!fs.existsSync(distPath)) {
          res.statusCode = 404;
          res.end('No production build found in dist/. Run `npm run build` first.');
          return;
        }
        res.setHeader('Content-Type', 'text/html');
        fs.createReadStream(distPath).pipe(res);
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isTest = mode === 'test' || process.env.VITEST;

  // BUILD_ENTRY allows building different HTML entry points separately.
  // Used by the build script to produce index.html, loop.html, and scenario.html.
  const buildEntry = process.env.BUILD_ENTRY || 'index.html';

  // SINGLE_FILE=true produces a self-contained single-file build (for HTML export).
  const singleFile = process.env.SINGLE_FILE === 'true';

  // BASE_PATH sets the public base path for deployed builds (e.g. '/repo-name/').
  const basePath = process.env.BASE_PATH || '/';

  const selfHostDir = path.resolve(__dirname, 'self-host');
  const readSelfHost = (name) => fs.readFileSync(path.join(selfHostDir, name), 'utf8');

  return {
    base: basePath,
    define: {
      'import.meta.env.SC_SINGLE_BUNDLE': JSON.stringify(singleFile),
      'import.meta.env.SC_SELF_HOST_SERVER_PY': JSON.stringify(readSelfHost('server.py')),
      'import.meta.env.SC_SELF_HOST_START_SH': JSON.stringify(readSelfHost('start.sh')),
      'import.meta.env.SC_SELF_HOST_START_PS1': JSON.stringify(readSelfHost('start.ps1')),
    },
    plugins: [...singleFile ? [viteSingleFile()] : [], serveExportBuild(), serveExamplePacks(), ...isTest || devCert ? [] : [basicSsl()]],
    server: {
      port: isTest ? 3456 : 3001,
      strictPort: true,
      // Reduce HMR logging in test mode
      hmr: isTest ? { overlay: false } : undefined,
      https: devCert && !isTest ? devCert : undefined,
    },
    build: {
      target: 'esnext',
      outDir: singleFile ? 'dist/export' : 'dist',
      rollupOptions: {
        input: buildEntry,
      },
      // Only clear dist/ on the first (index.html) build; subsequent builds append.
      // Always clear dist/export/ for export builds.
      emptyOutDir: singleFile || buildEntry === 'index.html',
    },
    // Reduce build logs in test mode
    logLevel: isTest ? 'error' : 'info',
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.js',
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
      css: {
        modules: {
          classNameStrategy: 'non-scoped'
        }
      },
      testTimeout: 20000,
    },
  };
})
