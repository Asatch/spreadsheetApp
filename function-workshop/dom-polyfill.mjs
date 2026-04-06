/**
 * Polyfill DOMParser and XMLSerializer for Node.js via jsdom.
 * Import this before anything that touches XML (e.g. the frontend transpiler).
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
