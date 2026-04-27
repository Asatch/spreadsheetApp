/**
 * Filesystem-backed function compiler for headless orchestrator usage.
 *
 * The frontend's functionCompiler accepts a single dep `loadFunctionFromOpfs(id)`
 * that returns { code, definition, metadata } | null. This module produces such
 * a loader by reading from a workfolder's registry.json (UUID -> file paths).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createFunctionCompiler } from '../src/Engines/functionCompiler.js';
import { extractSignatureFromXml } from '../src/utils/xmlSerializer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Build a functionCompiler whose dependencies come from a workfolder's registry.
 *
 * @param {string} workfolderDir - absolute path to the workfolder (must contain registry.json)
 * @returns {object} a functionCompiler instance, ready to inject into the orchestrator
 */
export function createFilesystemFunctionCompiler(workfolderDir) {
  const registryPath = resolve(workfolderDir, 'registry.json');
  if (!existsSync(registryPath)) {
    throw new Error(`Registry not found: ${registryPath}`);
  }
  const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

  // Build uuid -> entry index, since orchestrator looks up by UUID.
  const byUuid = new Map();
  for (const [name, entry] of Object.entries(registry)) {
    if (entry.uuid) byUuid.set(entry.uuid, { name, ...entry });
  }

  return createFunctionCompiler({
    loadFunctionFromOpfs: async (functionId) => {
      const entry = byUuid.get(functionId);
      if (!entry) return null;
      const xmlPath = resolve(workfolderDir, entry.xml);
      const jsPath = resolve(workfolderDir, entry.js);
      if (!existsSync(xmlPath) || !existsSync(jsPath)) return null;
      const definition = readFileSync(xmlPath, 'utf-8');
      const signature = extractSignatureFromXml(definition);
      return {
        code: readFileSync(jsPath, 'utf-8'),
        definition,
        metadata: {
          name: entry.name,
          publishedName: entry.name,
          version: entry.version || '1.0',
          versionId: entry.versionId || entry.uuid,
          sheetType: entry.sheetType || 'standard',
          sourceSpreadsheetId: entry.uuid,
          signature,
        },
      };
    },
  });
}
