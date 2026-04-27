/**
 * Build script for the SQLite example language pack.
 *
 * Defines SQLite-compatible SQL syntax + functions as readable JS, then
 * serializes them into the JSON import format expected by
 * languagePackEngine.importPack().
 *
 * Key differences from PostgreSQL pack:
 *   - No CREATE FUNCTION — output is a sequence of ALTER/UPDATE statements
 *   - No ARRAY types — aggregate functions use subqueries on JSON arrays
 *   - Loop sheets unroll iterations as repeated UPDATE statements
 *   - Function inputs become simple identifiers (bind parameters)
 *
 * Usage:
 *   node examples/build-sqlite-pack.mjs
 *
 * Output:
 *   examples/sqlite-language-pack.json
 */

import { serializeSyntaxObject } from '../src/transpiler/codegenJavascript.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════
// SQLITE SYNTAX OBJECT
//
// SQLite-compatible SQL. Uses a single-row _input table as a mutable
// namespace — each variable becomes a column via ALTER/UPDATE.
// Loop sheets unroll iterations as repeated UPDATE statements.
// ═══════════════════════════════════════════════════════════════════════

const SQLITE_SYNTAX = {

  // ── Values & identifiers ──────────────────────────────────────────

  constantValue(value, type) {
    if (type === 'Text') {
      const escaped = value.replace(/'/g, "''");
      return `'${escaped}'`;
    }
    if (type === 'Number') {
      // Always emit as REAL to match JS float semantics and avoid
      // SQLite integer division surprises.
      const s = String(value);
      return (s.includes('.') || s.includes('e') || s.includes('E')) ? s : s + '.0';
    }
    if (type === 'Boolean') return value.toLowerCase() === 'true' ? '1' : '0';
    throw new Error(`Unsupported value type: ${type}`);
  },

  safeName(name) {
    let safe = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!/^[a-z_]/.test(safe)) {
      safe = '_' + safe;
    }
    if (this.reservedWords.has(safe)) {
      safe = safe + '_';
    }
    return safe;
  },

  variableName(nodeId) {
    return 'col_' + String(nodeId);
  },

  // ── Statements ────────────────────────────────────────────────────

  persistConfig: {
    stepCountTradeOff: 2,
    totalStepsThreshold: 15,
    prohibitedTypes: []
  },

  declareVariable(name, value, _type) {
    return `ALTER TABLE _input ADD COLUMN ${name};\nUPDATE _input SET ${name} = ${value}`;
  },

  returnValue(expr) {
    return `SELECT ${expr} FROM _input`;
  },

  returnMultiple(entries) {
    const jsonParts = entries.map(({ name, expr }) => `'${name}', ${expr}`);
    return `SELECT JSON_OBJECT(${jsonParts.join(', ')}) FROM _input`;
  },

  returnArray(exprs) {
    return `SELECT ${exprs.join(', ')} FROM _input`;
  },

  // ── Data structures ───────────────────────────────────────────────

  arrayLiteral(elements) {
    return 'JSON_ARRAY(' + elements.join(', ') + ')';
  },

  objectPropertyAccess(objExpr, key) {
    const escaped = key.replace(/'/g, "''");
    return `JSON_EXTRACT(${objExpr}, '$.${escaped}')`;
  },

  objectPositionAccess(objExpr, position) {
    return `JSON_EXTRACT(${objExpr}, '$[${position - 1}]')`;
  },

  arrayIndexAccess(arrExpr, position) {
    // JSON arrays are 0-based in SQLite
    return `JSON_EXTRACT(${arrExpr}, '$[${position - 1}]')`;
  },

  arrayDynamicAccess(arrExpr, indexExpr) {
    // Runtime 1-based index → 0-based integer JSON path
    return `JSON_EXTRACT(${arrExpr}, '$[' || CAST((${indexExpr}) - 1 AS INTEGER) || ']')`;
  },

  // ── Function structure ────────────────────────────────────────────

  assembleFunction({ name, argNames, argTypes, bodyStatements, returnStatement, returnType, helpers }) {
    let code = '';
    if (helpers.length > 0) {
      code += helpers.join('\n\n') + '\n\n';
    }

    // Iteration body functions are inlined by renderLoop — no separate
    // function definition needed (SQLite has no CREATE FUNCTION).
    if (returnType === 'ARRAY') {
      return '';
    }

    code += `-- ${name}(${argNames.join(', ')})\n`;

    // Body statements are ALTER/UPDATE pairs that add computed columns
    // to the _input table. Each statement may contain multiple lines
    // (ALTER + UPDATE separated by \n).
    for (const s of bodyStatements) {
      // Each line within a statement gets its own semicolon
      for (const line of s.split('\n')) {
        if (line.trim()) code += line + ';\n';
      }
    }

    code += returnStatement + ';\n';

    return code;
  },

  renderLoop(loop) {
    const maxIter = loop.maxIterations || 100;
    const body = loop.iterationBody;
    if (!this._loopCounter) this._loopCounter = 0;
    this._loopCounter++;
    const prefix = `_loop${this._loopCounter}`;

    const registerNames = loop.registers.map(r => r.name);
    const outputOnlyNames = loop.outputOnlyCols.map(c => c.name);

    // Map iteration body param names → column names on _input.
    // The body uses "prev_d", "prev_e"; we rename to "_loop1_d", "_loop1_e".
    // External inputs (constants passed into the loop) are also mapped —
    // simple column refs substitute directly, computed expressions get
    // materialized as columns.
    const paramSubs = {};
    const externalColSetup = []; // ALTER/UPDATE pairs for computed externals
    if (body) {
      for (let i = 0; i < loop.registers.length; i++) {
        paramSubs[body.inputNames[i]] = `${prefix}_${registerNames[i]}`;
      }
      const extOffset = loop.registers.length;
      for (let i = 0; i < loop.externalExprs.length; i++) {
        const bodyName = body.inputNames[extOffset + i];
        const expr = loop.externalExprs[i];
        if (!bodyName || bodyName === expr) continue; // already matches

        // If the expression is a simple column ref, substitute directly
        if (/^\w+$/.test(expr)) {
          paramSubs[bodyName] = expr;
        } else {
          // Computed expression — materialize as a column
          const colName = `${prefix}_ext_${bodyName}`;
          paramSubs[bodyName] = colName;
          externalColSetup.push(
            `ALTER TABLE _input ADD COLUMN ${colName};\nUPDATE _input SET ${colName} = ${expr}`
          );
        }
      }
    }

    function subParams(expr) {
      let result = expr;
      for (const [from, to] of Object.entries(paramSubs)) {
        if (from === to) continue;
        result = result.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
      }
      return result;
    }

    // Parse body statements into preamble (ALTERs, run once) and iteration
    // (UPDATEs, repeated each iteration).
    //
    // Body statements come in three forms:
    //   1. ALTER+UPDATE pairs (from declareVariable): column creation + init
    //   2. ALTER-only (column creation from nested loops): preamble only
    //   3. UPDATE-only (iteration logic from nested loops): iteration only
    //
    // Names are prefixed with the loop prefix to avoid collisions when the
    // same loop function is called multiple times (e.g. COMBIN calls FACTORIAL 3x).
    const stopCol = `${prefix}__stop`;
    const bodyRenames = {}; // original name → prefixed name
    const bodyPreambleStmts = [];  // ALTERs → outer preamble (once)
    const bodyIterationStmts = []; // UPDATEs → each outer iteration

    const alterUpdateRe = /^ALTER TABLE _input ADD COLUMN (\w+)(?:\s+\w+)?;\nUPDATE _input SET (\w+) = (.+)$/;

    if (body) {
      // Phase 1: collect renames from ALTER+UPDATE pairs
      for (const stmt of body.bodyStatements) {
        const m = stmt.match(alterUpdateRe);
        if (m) {
          bodyRenames[m[1]] = `${prefix}_${m[1]}`;
        }
      }

      // Phase 2: process statements in original order, applying substitutions
      function applyAllRenames(s) {
        let result = subParams(s);
        for (const [from, to] of Object.entries(bodyRenames)) {
          if (from === to) continue;
          result = result.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
        }
        return result;
      }

      for (const stmt of body.bodyStatements) {
        const renamed = applyAllRenames(stmt);
        const m = renamed.match(alterUpdateRe);

        if (m) {
          // ALTER+UPDATE pair: ALTER in preamble (preserve type), guarded UPDATE in iteration
          const alterPart = renamed.split(';\n')[0];
          bodyPreambleStmts.push(alterPart);
          bodyIterationStmts.push(
            `UPDATE _input SET ${m[2]} = CASE WHEN ${stopCol} THEN ${m[2]} ELSE ${m[3]} END`
          );
        } else if (renamed.startsWith('ALTER TABLE _input')) {
          // ALTER-only (nested loop intermediate columns): preamble once
          bodyPreambleStmts.push(renamed);
        } else if (renamed.startsWith('UPDATE _input SET')) {
          // UPDATE-only (nested loop iterations): iteration, already has own guards
          bodyIterationStmts.push(renamed);
        }
      }
    }

    const preamble = [];

    // Materialize computed external inputs as columns
    preamble.push(...externalColSetup);

    // Initialize register columns
    for (const r of loop.registers) {
      preamble.push(`ALTER TABLE _input ADD COLUMN ${prefix}_${r.name};\nUPDATE _input SET ${prefix}_${r.name} = ${r.initExpr}`);
    }
    for (const c of loop.outputOnlyCols) {
      preamble.push(`ALTER TABLE _input ADD COLUMN ${prefix}_${c.name};\nUPDATE _input SET ${prefix}_${c.name} = ${c.initExpr || 'NULL'}`);
    }

    // Initialize stop column
    const initStop = loop.stop0Expr ? `(${loop.stop0Expr})` : '0';
    preamble.push(`ALTER TABLE _input ADD COLUMN ${stopCol} INTEGER;\nUPDATE _input SET ${stopCol} = ${initStop}`);

    // Body preamble: column declarations from body intermediates + nested loops
    preamble.push(...bodyPreambleStmts);

    // Build the iteration UPDATE statements
    const iterationStmts = [];

    // Body iteration: intermediates (guarded) + nested loop statements (own guards)
    iterationStmts.push(...bodyIterationStmts);

    // Build register + output-only update expressions
    function subBodyRenames(expr) {
      let result = expr;
      for (const [from, to] of Object.entries(bodyRenames)) {
        if (from === to) continue;
        result = result.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
      }
      return result;
    }

    const regUpdates = [];
    const registerExprs = body
      ? body.returnParts.slice(0, registerNames.length).map(p => subBodyRenames(subParams(p)))
      : registerNames;
    const outputOnlyExprs = body
      ? body.returnParts.slice(registerNames.length).map(p => subBodyRenames(subParams(p)))
      : outputOnlyNames;
    const stopExpr = body ? subBodyRenames(subParams(body.stopExpr)) : '1';

    for (let i = 0; i < registerNames.length; i++) {
      regUpdates.push(`${prefix}_${registerNames[i]} = CASE WHEN ${stopCol} THEN ${prefix}_${registerNames[i]} ELSE ${registerExprs[i]} END`);
    }
    for (let i = 0; i < outputOnlyNames.length; i++) {
      regUpdates.push(`${prefix}_${outputOnlyNames[i]} = CASE WHEN ${stopCol} THEN ${prefix}_${outputOnlyNames[i]} ELSE ${outputOnlyExprs[i]} END`);
    }
    regUpdates.push(`${stopCol} = CASE WHEN ${stopCol} THEN ${stopCol} ELSE ${stopExpr} END`);

    iterationStmts.push(`UPDATE _input SET ${regUpdates.join(', ')}`);

    // Unroll: repeat iteration statements maxIter times
    for (let i = 0; i < maxIter; i++) {
      preamble.push(...iterationStmts);
    }

    // Build the final expression that reads results
    const isMultiOutput = loop.outputCols.length > 1;
    let finalExpr;

    if (!isMultiOutput) {
      const c = loop.outputCols[0];
      finalExpr = `${prefix}_${c.name}`;
    } else {
      const jsonParts = loop.outputCols.map(c => {
        const key = `'${c.outputName}'`;
        return `${key}, ${prefix}_${c.name}`;
      });
      finalExpr = `JSON_OBJECT(${jsonParts.join(', ')})`;
    }

    return { preamble, expression: finalExpr };
  },

  // ── Engine hooks ──────────────────────────────────────────────────

  addCallMechanics(conversionRules) {
    const signatures = conversionRules.signatures || {};
    for (const funcName of Object.keys(signatures)) {
      for (const s of signatures[funcName]) {
        if (s.is_helper_function && !('code_before' in s)) {
          s.code_before = `${funcName}(`;
          s.code_after = ')';
        }
      }
    }
  },

  afterCodeNode(ctx, _G, _nodeId, functionSignature) {
    if (functionSignature.add_functions) {
      ctx.usedFunctions = new Set([
        ...ctx.usedFunctions,
        ...functionSignature.add_functions
      ]);
    }
  },

  initContext() {
    this._loopCounter = 0;
    return {};
  },

  wrapModule(code) {
    return code;
  },

  // ── Composable internals ──────────────────────────────────────────

  reservedWords: new Set([
    'abort', 'action', 'add', 'after', 'all', 'alter', 'and', 'as', 'asc',
    'attach', 'autoincrement', 'before', 'begin', 'between', 'by', 'cascade',
    'case', 'cast', 'check', 'collate', 'column', 'commit', 'conflict',
    'constraint', 'create', 'cross', 'current', 'default', 'deferrable',
    'deferred', 'delete', 'desc', 'detach', 'distinct', 'drop', 'each',
    'else', 'end', 'escape', 'except', 'exclusive', 'exists', 'explain',
    'fail', 'filter', 'following', 'for', 'foreign', 'from', 'full', 'glob',
    'group', 'having', 'if', 'ignore', 'immediate', 'in', 'index', 'indexed',
    'initially', 'inner', 'insert', 'instead', 'intersect', 'into', 'is',
    'isnull', 'join', 'key', 'left', 'like', 'limit', 'match', 'natural',
    'no', 'not', 'nothing', 'notnull', 'null', 'of', 'offset', 'on', 'or',
    'order', 'outer', 'over', 'partition', 'plan', 'pragma', 'preceding',
    'primary', 'query', 'raise', 'range', 'recursive', 'references',
    'regexp', 'reindex', 'release', 'rename', 'replace', 'restrict',
    'right', 'rollback', 'row', 'rows', 'savepoint', 'select', 'set',
    'table', 'temp', 'temporary', 'then', 'to', 'transaction', 'trigger',
    'unbounded', 'union', 'unique', 'update', 'using', 'vacuum', 'values',
    'view', 'virtual', 'when', 'where', 'window', 'with', 'without'
  ]),

  indent: '  ',

  functionHeader(name, argNames) {
    return `-- ${name}(${argNames.join(', ')})`;
  },

  functionFooter() {
    return '';
  },

  declareUninitializedVariable(name, _type) {
    return `ALTER TABLE _input ADD COLUMN ${name}`;
  },

  assignVariable(name, value) {
    return `UPDATE _input SET ${name} = ${value}`;
  },

  ifReturn(condExpr, returnStatement) {
    return `-- early return if ${condExpr}: ${returnStatement}`;
  },

  ifBreak(condExpr) {
    return `-- break if ${condExpr}`;
  },

  functionCall(name, argExprs) {
    return `${name}(${argExprs.join(', ')})`;
  },

  arrayPush(arrExpr, valExpr) {
    return `JSON_INSERT(${arrExpr}, '$[#]', ${valExpr})`;
  },

  destructureArray(varNames, rhsExpr, _varTypes) {
    return `-- destructure ${varNames.join(', ')} = ${rhsExpr}`;
  },

  wrapLoopExpression(_bodyLines) {
    throw new Error('SQLite renderLoop uses { preamble, expression } — wrapLoopExpression should not be called');
  },

  wrapInfiniteLoop(bodyLines) {
    return bodyLines;
  },

  loopReturnStatement(loop) {
    const entries = loop.outputCols.map(col => ({
      name: col.outputName,
      expr: col.isAllMode ? col.accName : col.name
    }));
    if (entries.length === 1) {
      return this.returnValue(entries[0].expr);
    }
    return this.returnMultiple(entries);
  },

  formatType(type) {
    if (!type) return 'NUMERIC';
    if (type === 'ARRAY') return 'TEXT'; // JSON arrays stored as TEXT
    const arrayMatch = type.match(/^ARRAY\[(.+)\]$/);
    if (arrayMatch) return 'TEXT'; // JSON array
    const objectMatch = type.match(/^Object\[(.+)\]$/);
    if (objectMatch) return 'TEXT'; // JSON object
    const map = { Number: 'NUMERIC', Text: 'TEXT', Boolean: 'INTEGER', Date: 'TEXT' };
    return map[type] || 'NUMERIC';
  },

  _indentLines(lines) {
    return lines
      .flatMap(line => line.split('\n'))
      .map(line => line === '' ? '' : this.indent + line);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// SQLITE SYNTAX ANNOTATIONS
// ═══════════════════════════════════════════════════════════════════════

const SQLITE_SYNTAX_ANNOTATIONS = {
  constantValue: [
    '═══════════════════════════════════════════════════════════════',
    'CODEGEN API — SQLite',
    '',
    'Methods the generic codegen engine calls directly.',
    'Standard sheets produce ALTER/UPDATE sequences on a single-row _input table.',
    'Loop sheets unroll iterations as repeated UPDATE statements.',
    '═══════════════════════════════════════════════════════════════',
    '',
    '── Values & identifiers ──────────────────────────────────────',
    '',
    'SQLite booleans are 0/1 integers.',
    'Text uses single quotes with doubled escaping.'
  ].join('\n'),

  persistConfig: [
    '── Statements ──────────────────────────────────────────────',
    '',
    'Each persisted value becomes a column on the _input table.',
    'ALTER TABLE adds the column, UPDATE sets its value.'
  ].join('\n'),

  arrayLiteral: [
    '── Data structures ─────────────────────────────────────────',
    '',
    'SQLite has no native arrays — uses JSON functions instead.',
    'JSON_ARRAY() creates arrays, JSON_EXTRACT() reads them.'
  ].join('\n'),

  assembleFunction: [
    '── Function structure ──────────────────────────────────────────',
    '',
    'SQLite has no CREATE FUNCTION — output is a sequence of',
    'ALTER/UPDATE statements on a single-row _input table.',
    'Input parameters are columns on that table.',
    '',
    'renderLoop unrolls iterations as repeated UPDATE statements.',
    'The iteration body is inlined into each unrolled step.'
  ].join('\n'),

  addCallMechanics: [
    '── Engine hooks ────────────────────────────────────────────',
    '',
    'initContext returns {} — no special tracking needed.',
    'wrapModule is a no-op — no import system in SQLite.'
  ].join('\n'),

  reservedWords: [
    '═══════════════════════════════════════════════════════════════',
    'COMPOSABLE INTERNALS — SQLite',
    '',
    'Many composable internals are no-ops because renderLoop is',
    'fully overridden for the unrolled UPDATE pattern.',
    '═══════════════════════════════════════════════════════════════',
    '',
    '── Reserved words ──────────────────────────────────────────────'
  ].join('\n'),

  indent: '── Used by assembleFunction ─────────────────────────────────',

  declareUninitializedVariable: '── Used by renderLoop (fallback only) ──────────────────────',

  formatType: [
    '── Type formatting ─────────────────────────────────────────',
    '',
    'Maps spreadsheet types to SQLite types:',
    '  Number → NUMERIC, Text → TEXT, Boolean → INTEGER',
    '  Arrays/Objects → TEXT (stored as JSON strings)'
  ].join('\n'),

  _indentLines: '── Shared internal helpers ──────────────────────────────────'
};

// ═══════════════════════════════════════════════════════════════════════
// SQLITE FUNCTIONS DATA
// ═══════════════════════════════════════════════════════════════════════

const sqliteFunctions = {
  signatures: {
    NEGATE: [
      { inputs: ['Number'], outputs: ['Number'], code_before: '-(', code_after: ')' }
    ],
    NOT: [
      { inputs: ['Boolean'], outputs: ['Boolean'], code_before: 'NOT (', code_after: ')' }
    ],
    LEN: [
      { inputs: ['ARRAY[*]'], outputs: ['Number'], code_before: 'JSON_ARRAY_LENGTH(', code_after: ')' }
    ],
    SIN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'SIN(', code_after: ')' }
    ],
    COS: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'COS(', code_after: ')' }
    ],
    ASIN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'ASIN(', code_after: ')' }
    ],
    ACOS: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'ACOS(', code_after: ')' }
    ],
    ATAN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'ATAN(', code_after: ')' }
    ],
    EXP: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'EXP(', code_after: ')' }
    ],
    LN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'LN(', code_after: ')' }
    ],
    FLOOR: [
      { inputs: ['Number'], outputs: ['Number'], template: 'FLOOR_SQLITE' }
    ],
    MOD: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], template: 'MOD_SQLITE' }
    ],
    SUM: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: '(SELECT SUM(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    MIN: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: '(SELECT MIN(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    MAX: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: '(SELECT MAX(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    COUNT: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: '(SELECT COUNT(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    AND: [
      {
        inputs: ['ARRAY[Boolean]'], outputs: ['Boolean'],
        code_before: '(SELECT MIN(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    OR: [
      {
        inputs: ['ARRAY[Boolean]'], outputs: ['Boolean'],
        code_before: '(SELECT MAX(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    AVERAGE: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: '(SELECT AVG(value) FROM JSON_EACH(', code_after: '))'
      }
    ],
    PRODUCT: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: 'sc_product_json(', code_after: ')',
        add_functions: ['SC_PRODUCT_JSON']
      }
    ],
    ADD: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], operator: '+', code_before: '(', code_after: ')' }
    ],
    SUBTRACT: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], operator: '-', code_before: '(', code_after: ')' }
    ],
    MULTIPLY: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], operator: '*', code_before: '(', code_after: ')' }
    ],
    DIVIDE: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], operator: '/', code_before: '(', code_after: ')' }
    ],
    EXPONENT: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], code_before: 'POWER(', code_after: ')' }
    ],
    GREATER: [
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '>', code_before: '(', code_after: ')' }
    ],
    LESS: [
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '<', code_before: '(', code_after: ')' }
    ],
    GREATEREQUAL: [
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '>=', code_before: '(', code_after: ')' }
    ],
    LESSEQUAL: [
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '<=', code_before: '(', code_after: ')' }
    ],
    '&': [
      { inputs: ['Text', 'Text'], outputs: ['Text'], operator: '||', code_before: '(', code_after: ')' }
    ],
    EQUAL: [
      { inputs: ['Text', 'Text'], outputs: ['Boolean'], operator: '=', code_before: '(', code_after: ')' },
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '=', code_before: '(', code_after: ')' },
      { inputs: ['Boolean', 'Boolean'], outputs: ['Boolean'], operator: '=', code_before: '(', code_after: ')' }
    ],
    NOTEQUAL: [
      { inputs: ['Text', 'Text'], outputs: ['Boolean'], operator: '<>', code_before: '(', code_after: ')' },
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '<>', code_before: '(', code_after: ')' },
      { inputs: ['Boolean', 'Boolean'], outputs: ['Boolean'], operator: '<>', code_before: '(', code_after: ')' }
    ],
    IF: [
      { inputs: ['Boolean', 'Number', 'Number'], outputs: ['Number'], template: 'IF_CASE' },
      { inputs: ['Boolean', 'Text', 'Text'], outputs: ['Text'], template: 'IF_CASE' },
      { inputs: ['Boolean', 'Boolean', 'Boolean'], outputs: ['Boolean'], template: 'IF_CASE' }
    ],
  },

  functions: {
    SC_PRODUCT_JSON: {
      text: '-- sc_product_json: PRODUCT over a JSON array via EXP(SUM(LN(...)))\n-- Referenced inline via subquery pattern.'
    },
  },

  templates: {
    IF_CASE: {
      'force-persist': false,
      'no-persist-template': 'CASE WHEN <input1> THEN <input2> ELSE <input3> END'
    },
    FLOOR_SQLITE: {
      'force-persist': false,
      'no-persist-template': 'CASE WHEN <input1> >= 0 OR <input1> = CAST(<input1> AS INTEGER) THEN CAST(<input1> AS INTEGER) ELSE CAST(<input1> AS INTEGER) - 1 END'
    },
    MOD_SQLITE: {
      'force-persist': false,
      'no-persist-template': '(<input1> - (CASE WHEN (<input1> * 1.0 / <input2>) >= 0 OR (<input1> * 1.0 / <input2>) = CAST((<input1> * 1.0 / <input2>) AS INTEGER) THEN CAST((<input1> * 1.0 / <input2>) AS INTEGER) ELSE CAST((<input1> * 1.0 / <input2>) AS INTEGER) - 1 END) * <input2>)'
    }
  },

  transforms: {},
  function_logic_dags: {}
};

// ═══════════════════════════════════════════════════════════════════════
// OVERRIDES SOURCE
// ═══════════════════════════════════════════════════════════════════════

const overridesSource = `{
  // Custom function overrides for SQLite.
  //
  // When a spreadsheet function has an override here, the transpiler
  // emits a simple function call and prepends your hand-written
  // SQLite implementation instead of expanding the DAG.
}`;

// ═══════════════════════════════════════════════════════════════════════
// BUILD
// ═══════════════════════════════════════════════════════════════════════

const syntaxSource = serializeSyntaxObject(SQLITE_SYNTAX, SQLITE_SYNTAX_ANNOTATIONS);

const pack = {
  type: 'sc-language-pack',
  version: '1.0',
  meta: {
    name: 'SQL (SQLite)',
    description: 'Example SQLite language pack — generates SQLite-compatible SQL using a single-row _input table. Loop sheets unroll iterations as repeated UPDATEs. No CREATE FUNCTION; output is bare statements.',
    fileExtension: '.sql'
  },
  syntax: syntaxSource,
  functions: sqliteFunctions,
  overrides: overridesSource
};

const outPath = join(__dirname, 'sqlite-language-pack.json');
writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');
console.log(`Written: ${outPath}`);
