/**
 * Load and register custom functions from a workfolder directory.
 * Uses registry.json + local .js files (no database).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseXML } from './xml-parser.mjs';

/**
 * Load registry.json from a workfolder directory.
 * @param {string} workfolderDir - Absolute path to workfolder directory
 * @returns {Object} Registry object (function name -> entry)
 */
export function loadRegistry(workfolderDir) {
  const regPath = resolve(workfolderDir, 'registry.json');
  if (!existsSync(regPath)) return {};
  return JSON.parse(readFileSync(regPath, 'utf-8'));
}

/**
 * Build a customFunctions map for the transpiler from a workfolder registry.
 * Returns { [uuid]: { name, xml_content } } — the format transpileToLang expects.
 *
 * @param {string} workfolderDir - Absolute path to workfolder directory
 * @param {Object} [registry] - Pre-loaded registry (loaded from workfolderDir if omitted)
 * @returns {Object} Custom functions keyed by UUID
 */
export function buildTranspilerCustomFunctions(workfolderDir, registry) {
  if (!registry) registry = loadRegistry(workfolderDir);
  const customFunctions = {};

  for (const [funcName, entry] of Object.entries(registry)) {
    if (!entry.uuid) continue;
    const xmlPath = resolve(workfolderDir, entry.xml || `${funcName}.xml`);
    if (!existsSync(xmlPath)) continue;

    customFunctions[entry.uuid] = {
      name: funcName,
      xml_content: readFileSync(xmlPath, 'utf-8')
    };
  }

  return customFunctions;
}

/**
 * Discover all transitive dependencies for a set of direct dependencies.
 * Walks the registry's dependency arrays.
 *
 * @param {Array} directDeps - Array of {name, id, version} from XML CustomFunctions
 * @param {Object} registry - Workfolder registry
 * @returns {Array<{name, id, version}>} All functions needed (no duplicates)
 */
export function discoverAllDependencies(directDeps, registry) {
  const allDeps = new Map();
  const toProcess = [...directDeps];
  const processed = new Set();

  while (toProcess.length > 0) {
    const dep = toProcess.pop();
    if (processed.has(dep.name)) continue;
    processed.add(dep.name);
    allDeps.set(dep.name, dep);

    const entry = registry[dep.name];
    if (!entry) continue;

    for (const nestedName of (entry.dependencies || [])) {
      if (!processed.has(nestedName) && registry[nestedName]) {
        toProcess.push({
          name: nestedName,
          id: registry[nestedName].uuid,
          version: '1.0.0'
        });
      }
    }
  }

  return Array.from(allDeps.values());
}

/**
 * Load and register custom functions with the calculation engine.
 * Reads transpiled JS from the workfolder directory.
 *
 * @param {Object} engine - The calculation engine
 * @param {Array} customFunctions - Array of {name, id, version} from XML
 * @param {string} workfolderDir - Absolute path to workfolder directory
 */
export function loadAndRegisterCustomFunctions(engine, customFunctions, workfolderDir) {
  const registry = loadRegistry(workfolderDir);
  const allDeps = discoverAllDependencies(customFunctions, registry);

  const functionsToRegister = {};

  for (const funcDef of allDeps) {
    const entry = registry[funcDef.name];
    if (!entry) {
      throw new Error(`Custom function ${funcDef.name} not found in workfolder registry`);
    }

    const jsPath = resolve(workfolderDir, entry.js);
    if (!existsSync(jsPath)) {
      throw new Error(
        `No transpiled JS for ${funcDef.name} at ${jsPath}. Run transpile.mjs first.`
      );
    }

    const jsCode = readFileSync(jsPath, 'utf-8');
    const wrappedCode = `${jsCode}\nreturn ${funcDef.name};`;
    const transpiledFunc = new Function(wrappedCode)();

    // Read XML to extract input/output type signatures
    const xmlPath = resolve(workfolderDir, entry.xml);
    const xmlContent = readFileSync(xmlPath, 'utf-8');
    const parsed = parseXML(xmlContent);

    const argTypes = parsed.inputs.map(inp => inp.data_type);
    const returnType = parsed.outputs.length > 1
      ? `Object[${parsed.outputs.map(o => o.data_type).join(', ')}]`
      : (parsed.outputs[0]?.data_type || 'Number');

    functionsToRegister[funcDef.name] = {
      variants: [{
        argTypes,
        returnType,
        impl: (values) => {
          const args = values.map(v => v.refValue);
          return { value: transpiledFunc(...args) };
        }
      }],
      id: funcDef.id || entry.uuid,
      version: funcDef.version || '1.0.0'
    };
  }

  if (Object.keys(functionsToRegister).length > 0) {
    engine.registerFunction(functionsToRegister);
  }
}
