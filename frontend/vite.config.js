import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * Dev-only plugin: serves example zips from function-workshop/examples/ at /examples/
 * so the app can fetch and import example packs during development.
 */
function serveExamplePacks() {
  return {
    name: 'serve-example-packs',
    configureServer(server) {
      server.middlewares.use('/examples', (req, res, next) => {
        const examplesDir = path.resolve(__dirname, '..', 'function-workshop', 'examples');

        // Serve the catalog
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

        // Serve .zip files
        const fileName = decodeURIComponent(req.url.replace(/^\//, ''));
        if (!fileName.endsWith('.zip') || fileName.includes('..')) {
          return next();
        }
        const filePath = path.resolve(examplesDir, fileName);
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

  return {
    base: basePath,
    plugins: [...singleFile ? [viteSingleFile()] : [], serveExportBuild(), serveExamplePacks(), ...isTest ? [] : [basicSsl()]],
    server: {
      port: isTest ? 3456 : 3001,
      strictPort: true,
      // Reduce HMR logging in test mode
      hmr: isTest ? { overlay: false } : undefined,
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
      css: {
        modules: {
          classNameStrategy: 'non-scoped'
        }
      },
      testTimeout: 20000,
    },
  };
})
