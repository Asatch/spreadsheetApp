/**
 * LANGUAGE PACK ENGINE
 * ====================
 * Manages language packs for exporting spreadsheet logic as code in
 * different languages. JavaScript remains the runtime language — other
 * language packs are export-only.
 *
 * The built-in JavaScript pack is never stored in OPFS — it's served
 * directly from the imported modules.
 */

import { JAVASCRIPT_SYNTAX, JAVASCRIPT_SYNTAX_ANNOTATIONS, serializeSyntaxObject, reconstructSyntaxObject, parseSyntaxSections, joinSyntaxSections, extractSectionHeaders, formatReferenceContent } from '../transpiler/codegenJavascript.js';
import { transpileToLang } from '../transpiler/index.js';
import javascriptFunctions from '../transpiler/data/javascriptFunctions.js';
import * as validation from '../transpiler/validation.js';

const BUILTIN_JS_ID = '__builtin_javascript__';

// Default overrides source — shown when creating a new pack or when the
// builtin pack is opened. JS object literal so comments are preserved.
const DEFAULT_OVERRIDES_SOURCE = `{
  // Custom function overrides: function name → hand-written implementation.
  //
  // Normally, when a spreadsheet function is used, its DAG (the graph of
  // cells and formulas) is expanded inline — every intermediate step is
  // transpiled into the output code. An override replaces that: instead
  // of expanding the DAG, the transpiler emits a simple function call and
  // prepends your hand-written implementation.
  //
  // Use overrides when you want to:
  //   - Replace a transpiled function with a hand-optimized version
  //   - Use a third-party library instead of generated code
  //   - Provide a language-specific implementation (e.g. Python, SQL)
  //
  // Format: each key is an UPPERCASE function name, and the value is the
  // complete function definition as a string.
  //
  // Example:
  //   "CALCULATE_TAX": "function CALCULATE_TAX(income, rate) {\\n  return income * rate;\\n}"
}`;

export function createLanguagePackEngine() {
  let opfsService = null;

  function init({ opfsService: opfs }) {
    opfsService = opfs;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  async function listPacks() {
    const packs = [{
      id: BUILTIN_JS_ID,
      name: 'JavaScript',
      description: 'Built-in JavaScript transpiler',
      fileExtension: '.js',
      isBuiltin: true
    }];

    if (!opfsService) return packs;

    const manifest = await opfsService.readLanguagePackManifest();
    for (const [id, meta] of Object.entries(manifest.packs || {})) {
      packs.push({
        id,
        name: meta.name,
        description: meta.description,
        fileExtension: meta.fileExtension,
        isBuiltin: false
      });
    }

    return packs;
  }

  async function loadPack(id) {
    if (id === BUILTIN_JS_ID) {
      return {
        syntax: serializeSyntaxObject(JAVASCRIPT_SYNTAX, extractSectionHeaders(JAVASCRIPT_SYNTAX_ANNOTATIONS)),
        functions: javascriptFunctions,
        overrides: DEFAULT_OVERRIDES_SOURCE,
        meta: {
          name: 'JavaScript',
          description: 'Built-in JavaScript transpiler',
          fileExtension: '.js'
        }
      };
    }

    const manifest = await opfsService.readLanguagePackManifest();
    const meta = manifest.packs[id];
    if (!meta) throw new Error(`Language pack not found: ${id}`);

    const syntaxSource = await opfsService.loadLanguagePackFile(id, 'syntax.js');
    const functionsJson = await opfsService.loadLanguagePackFile(id, 'functions.json');
    const functionsData = JSON.parse(functionsJson);

    // Load overrides source — migrate from functions.json if overrides.js
    // doesn't exist yet (packs saved before overrides became a separate file)
    let overridesSource;
    try {
      overridesSource = await opfsService.loadLanguagePackFile(id, 'overrides.js');
    } catch {
      const { customFunctionOverrides } = functionsData;
      if (customFunctionOverrides && Object.keys(customFunctionOverrides).length > 0) {
        overridesSource = JSON.stringify(customFunctionOverrides, null, 2);
      } else {
        overridesSource = DEFAULT_OVERRIDES_SOURCE;
      }
    }

    // Strip overrides from functions data — it's in its own file now
    delete functionsData.customFunctionOverrides;

    return {
      syntax: syntaxSource,
      functions: functionsData,
      overrides: overridesSource,
      meta: {
        name: meta.name,
        description: meta.description,
        fileExtension: meta.fileExtension
      }
    };
  }

  async function savePack(id, { syntax, functions, overrides, meta }) {
    if (id === BUILTIN_JS_ID) {
      throw new Error('Cannot modify the built-in JavaScript pack');
    }

    // Save files
    await opfsService.saveLanguagePackFile(id, 'syntax.js', syntax);
    await opfsService.saveLanguagePackFile(
      id, 'functions.json',
      typeof functions === 'string' ? functions : JSON.stringify(functions, null, 2)
    );
    await opfsService.saveLanguagePackFile(id, 'overrides.js', overrides);

    // Update manifest
    const manifest = await opfsService.readLanguagePackManifest();
    const now = new Date().toISOString();
    const existing = manifest.packs[id];
    manifest.packs[id] = {
      name: meta.name,
      description: meta.description || '',
      fileExtension: meta.fileExtension || '.txt',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await opfsService.writeLanguagePackManifest(manifest);
  }

  async function deletePack(id) {
    if (id === BUILTIN_JS_ID) {
      throw new Error('Cannot delete the built-in JavaScript pack');
    }

    await opfsService.deleteLanguagePackFiles(id);

    const manifest = await opfsService.readLanguagePackManifest();
    delete manifest.packs[id];
    await opfsService.writeLanguagePackManifest(manifest);
  }

  // ── Import / Export ───────────────────────────────────────────────────

  function exportPack(packData) {
    return JSON.stringify({
      type: 'sc-language-pack',
      version: '1.0',
      meta: packData.meta,
      syntax: packData.syntax,
      functions: packData.functions,
      overrides: packData.overrides
    }, null, 2);
  }

  function importPack(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.type !== 'sc-language-pack') {
      throw new Error('Invalid language pack format: missing type field');
    }
    if (!data.meta?.name) {
      throw new Error('Invalid language pack format: missing meta.name');
    }
    if (!data.syntax) {
      throw new Error('Invalid language pack format: missing syntax');
    }
    if (!data.functions) {
      throw new Error('Invalid language pack format: missing functions');
    }

    const id = crypto.randomUUID();
    return {
      id,
      syntax: data.syntax,
      functions: data.functions,
      overrides: data.overrides || DEFAULT_OVERRIDES_SOURCE,
      meta: data.meta
    };
  }

  // ── Runtime ───────────────────────────────────────────────────────────

  function reconstructSyntax(syntaxSource) {
    return reconstructSyntaxObject(syntaxSource);
  }

  function reconstructOverrides(overridesSource) {
    return reconstructSyntaxObject(overridesSource || '{}');
  }

  function parseFunctions(functionsJson) {
    return typeof functionsJson === 'string' ? JSON.parse(functionsJson) : functionsJson;
  }

  // ── Cloning ───────────────────────────────────────────────────────────

  function getBuiltinSyntaxSource() {
    return serializeSyntaxObject(JAVASCRIPT_SYNTAX, extractSectionHeaders(JAVASCRIPT_SYNTAX_ANNOTATIONS));
  }

  function getReferenceContent() {
    return formatReferenceContent(JAVASCRIPT_SYNTAX_ANNOTATIONS);
  }

  function getBuiltinFunctionsData() {
    return javascriptFunctions;
  }

  function getDefaultOverridesSource() {
    return DEFAULT_OVERRIDES_SOURCE;
  }

  // ── Transpile ─────────────────────────────────────────────────────────

  async function transpileWithPack(packId, xmlContent, customFunctions) {
    const packData = await loadPack(packId);
    const syntaxObj = reconstructSyntaxObject(packData.syntax);
    const functionsData = parseFunctions(packData.functions);
    functionsData.customFunctionOverrides = reconstructOverrides(packData.overrides);
    return transpileWithPackData(syntaxObj, functionsData, xmlContent, customFunctions);
  }

  function transpileWithPackData(syntaxObj, functionsData, xmlContent, customFunctions) {
    return transpileToLang(xmlContent, customFunctions, syntaxObj, functionsData);
  }

  // ── Validation ────────────────────────────────────────────────────────

  function isValidFunctionsData(functionsData) {
    return validation.isValidConversionRulesDict(functionsData);
  }

  function parseSections(source) {
    return parseSyntaxSections(source);
  }

  function joinSections(sections) {
    return joinSyntaxSections(sections);
  }

  return {
    init,
    listPacks,
    loadPack,
    savePack,
    deletePack,
    exportPack,
    importPack,
    reconstructSyntax,
    reconstructOverrides,
    parseFunctions,
    parseSections,
    joinSections,
    getBuiltinSyntaxSource,
    getBuiltinFunctionsData,
    getDefaultOverridesSource,
    transpileWithPack,
    transpileWithPackData,
    isValidFunctionsData,
    getReferenceContent,
    BUILTIN_JS_ID
  };
}
