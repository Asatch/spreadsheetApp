/**
 * Build script for the Python example language pack.
 *
 * Defines Python syntax + functions as readable JS, then serializes them
 * into the JSON import format expected by languagePackEngine.importPack().
 *
 * Usage:
 *   node examples/build-python-pack.mjs
 *
 * Output:
 *   examples/python-language-pack.json
 */

import { serializeSyntaxObject } from '../src/transpiler/codegenJavascript.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════
// PYTHON SYNTAX OBJECT
//
// Adapts every method from JAVASCRIPT_SYNTAX for Python output.
// The annotations object below provides the editor comments.
// ═══════════════════════════════════════════════════════════════════════

const PYTHON_SYNTAX = {

  // ── Values & identifiers ──────────────────────────────────────────

  constantValue(value, type) {
    if (type === 'Text') {
      const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `'${escaped}'`;
    }
    if (type === 'Number') return String(value);
    if (type === 'Boolean') return value.toLowerCase() === 'true' ? 'True' : 'False';
    throw new Error(`Unsupported value type: ${type}`);
  },

  safeName(name) {
    if (this.reservedWords.has(name.toLowerCase())) {
      name = name + '_';
    }
    if (!/^[a-zA-Z_]/.test(name)) {
      name = '_' + name;
    }
    let safe = '';
    for (const ch of name) {
      safe += /[a-zA-Z0-9_]/.test(ch) ? ch : '_';
    }
    return safe;
  },

  variableName(nodeId) {
    return 'var_' + String(nodeId);
  },

  // ── Statements ────────────────────────────────────────────────────

  persistConfig: {
    stepCountTradeOff: 5,
    totalStepsThreshold: 25,
    prohibitedTypes: []
  },

  declareVariable(name, value, _type) {
    return `${name} = ${value}`;
  },

  returnValue(expr) {
    return `return ${expr}`;
  },

  returnMultiple(entries) {
    const parts = entries.map(({ name, expr }) => `'${name}': ${expr}`);
    return `return {${parts.join(', ')}}`;
  },

  returnArray(exprs) {
    return `return [${exprs.join(', ')}]`;
  },

  // ── Data structures ───────────────────────────────────────────────

  arrayLiteral(elements) {
    return '[' + elements.join(', ') + ']';
  },

  objectPropertyAccess(objExpr, key) {
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${objExpr}["${escaped}"]`;
  },

  objectPositionAccess(objExpr, position) {
    return `list(${objExpr}.values())[${position - 1}]`;
  },

  arrayIndexAccess(arrExpr, position) {
    return `${arrExpr}[${position - 1}]`;
  },

  arrayDynamicAccess(arrExpr, indexExpr) {
    return `${arrExpr}[int(${indexExpr}) - 1]`;
  },

  // ── Function structure ────────────────────────────────────────────

  assembleFunction({ name, argNames, argTypes, bodyStatements, returnStatement, returnType, helpers }) {
    // Build typed parameter list: "a: float, b: str"
    const params = argNames.map((n, i) => {
      const t = argTypes?.[i];
      return t ? `${n}: ${this.formatType(t)}` : n;
    });

    // Build return type annotation
    const retAnnotation = returnType ? ` -> ${this.formatType(returnType)}` : '';

    const header = `def ${name}(${params.join(', ')})${retAnnotation}:`;
    const indented = this._indentLines([...bodyStatements, returnStatement]);
    const body = indented.join('\n');

    let code = '';
    if (helpers.length > 0) {
      code += helpers.join('\n\n') + '\n\n';
    }
    code += header + '\n' + body + '\n';
    return code;
  },

  renderLoop(loop) {
    // Python can't use an IIFE like JS. Instead, define a nested function
    // and call it. The engine supports { preamble, expression } returns
    // for exactly this pattern.
    const bodyLines = [];

    // Initialize registers
    for (const reg of loop.registers) {
      bodyLines.push(this.declareVariable(reg.name, reg.initExpr, reg.type));
    }

    // Initialize output-only columns
    for (const col of loop.outputOnlyCols) {
      bodyLines.push(col.initExpr
        ? this.declareVariable(col.name, col.initExpr, col.type)
        : this.declareUninitializedVariable(col.name, col.type));
    }

    // Initialize accumulators for "all" mode columns
    const allModeCols = loop.outputCols.filter(c => c.isAllMode);
    for (const col of allModeCols) {
      bodyLines.push(this.declareVariable(col.accName, this.arrayLiteral([])));
    }

    // Early return if stop0 is true
    if (loop.stop0Expr) {
      bodyLines.push(this.ifReturn(loop.stop0Expr, this.loopReturnStatement(loop)));
    }

    // Build while-loop body
    const whileBody = [];

    const iterArgs = [
      ...loop.registers.map(r => r.name),
      ...loop.externalExprs
    ];
    const returnVars = [
      ...loop.registers.map(r => r.newName),
      ...loop.outputOnlyCols.map(c => c.newName),
      'stop'
    ];
    whileBody.push(this.destructureArray(
      returnVars,
      this.functionCall(loop.iterationFuncName, iterArgs)
    ));

    for (const reg of loop.registers) {
      whileBody.push(this.assignVariable(reg.name, reg.newName));
    }
    for (const col of loop.outputOnlyCols) {
      whileBody.push(this.assignVariable(col.name, col.newName));
    }
    for (const col of allModeCols) {
      whileBody.push(this.arrayPush(col.accName, col.name));
    }
    whileBody.push(this.ifBreak('stop'));

    bodyLines.push(...this.wrapInfiniteLoop(whileBody));
    bodyLines.push(this.loopReturnStatement(loop));

    // Emit as a nested function def (preamble) + call (expression).
    // Use a counter to ensure unique names when the same loop function
    // is called multiple times (e.g. COMBIN calls FACTORIAL 3 times).
    if (!this._loopCounter) this._loopCounter = 0;
    this._loopCounter++;
    const funcName = `_loop_${loop.iterationFuncName}_${this._loopCounter}`;
    const preamble = [
      `def ${funcName}():`,
      ...this._indentLines(bodyLines)
    ];

    return { preamble, expression: `${funcName}()` };
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
    // Track imports needed by this function signature
    if (functionSignature._imports) {
      for (const imp of functionSignature._imports) {
        ctx.usedImports.add(imp);
      }
    }
  },

  initContext() {
    return { usedImports: new Set() };
  },

  wrapModule(code) {
    // Scan the generated code for imports we need to add.
    // This is reliable because we control what code is emitted.
    const lines = [];
    if (/\bmath\./.test(code)) {
      lines.push('import math');
    }
    if (lines.length > 0) {
      return lines.join('\n') + '\n\n' + code;
    }
    return code;
  },

  // ── Composable internals ──────────────────────────────────────────

  reservedWords: new Set([
    'false', 'none', 'true', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
    'while', 'with', 'yield'
  ]),

  indent: '    ',

  functionHeader(name, argNames) {
    return `def ${name}(${argNames.join(', ')}):`;
  },

  functionFooter() {
    return '';
  },

  declareUninitializedVariable(name, _type) {
    return `${name} = None`;
  },

  assignVariable(name, value) {
    return `${name} = ${value}`;
  },

  ifReturn(condExpr, returnStatement) {
    return `if ${condExpr}:\n    ${returnStatement}`;
  },

  ifBreak(condExpr) {
    return `if ${condExpr}:\n    break`;
  },

  functionCall(name, argExprs) {
    return `${name}(${argExprs.join(', ')})`;
  },

  arrayPush(arrExpr, valExpr) {
    return `${arrExpr}.append(${valExpr})`;
  },

  destructureArray(varNames, rhsExpr, _varTypes) {
    return `${varNames.join(', ')} = ${rhsExpr}`;
  },

  // Not used — this pack's renderLoop uses { preamble, expression } instead
  // of wrapping everything in an expression. Kept as a no-op for completeness.
  wrapLoopExpression(_bodyLines) {
    throw new Error('Python renderLoop uses { preamble, expression } — wrapLoopExpression should not be called');
  },

  wrapInfiniteLoop(bodyLines) {
    const indented = this._indentLines(bodyLines);
    return ['while True:', ...indented];
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
    if (!type) return type;
    if (type === 'ARRAY') return 'list';
    const arrayMatch = type.match(/^ARRAY\[(.+)\]$/);
    if (arrayMatch) return `list[${this.formatType(arrayMatch[1])}]`;
    const objectMatch = type.match(/^Object\[(.+)\]$/);
    if (objectMatch) return 'dict';
    const map = { Number: 'float', Text: 'str', Boolean: 'bool', Date: 'date' };
    return map[type] || type;
  },

  _indentLines(lines) {
    return lines
      .flatMap(line => line.split('\n'))
      .map(line => line === '' ? '' : this.indent + line);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// PYTHON SYNTAX ANNOTATIONS
//
// Comments shown in the language pack editor for each section.
// ═══════════════════════════════════════════════════════════════════════

const PYTHON_SYNTAX_ANNOTATIONS = {
  constantValue: [
    '═══════════════════════════════════════════════════════════════',
    'CODEGEN API — Python',
    '',
    'Methods the generic codegen engine calls directly.',
    'Adapted from JavaScript for Python output.',
    '═══════════════════════════════════════════════════════════════',
    '',
    '── Values & identifiers ──────────────────────────────────────'
  ].join('\n'),

  persistConfig: [
    '── Statements ──────────────────────────────────────────────',
    '',
    'Python uses no semicolons and no `let` keyword.',
    'Variables are assigned directly: name = value'
  ].join('\n'),

  arrayLiteral: '── Data structures ─────────────────────────────────────────',

  assembleFunction: [
    '── Function structure ──────────────────────────────────────────',
    '',
    'Python uses `def name(args):` with indented body.',
    'Type hints are added when type information is available.',
    '',
    'renderLoop returns { preamble, expression } instead of a string.',
    'Python can\'t express loops as inline expressions (no IIFE), so',
    'the loop body is emitted as a nested `def` (preamble), and the',
    'expression is just the function call.'
  ].join('\n'),

  addCallMechanics: [
    '── Engine hooks ────────────────────────────────────────────',
    '',
    'initContext returns { usedImports: new Set() } to track',
    'which Python imports are needed (e.g., math).',
    '',
    'afterCodeNode checks for _imports on function signatures',
    'and adds them to ctx.usedImports.',
    '',
    'wrapModule prepends `import math` (and others) based on',
    'what was actually used.'
  ].join('\n'),

  reservedWords: [
    '═══════════════════════════════════════════════════════════════',
    'COMPOSABLE INTERNALS — Python',
    '',
    'Methods called by assembleFunction and renderLoop.',
    '═══════════════════════════════════════════════════════════════',
    '',
    '── Reserved words ──────────────────────────────────────────────'
  ].join('\n'),

  indent: '── Used by assembleFunction ─────────────────────────────────',

  declareUninitializedVariable: '── Used by renderLoop ──────────────────────────────────────',

  formatType: [
    '── Type formatting ─────────────────────────────────────────',
    '',
    'Maps spreadsheet types to Python type hints:',
    '  Number → float, Text → str, Boolean → bool',
    '  ARRAY[Number] → list[float], etc.'
  ].join('\n'),

  _indentLines: '── Shared internal helpers ──────────────────────────────────'
};

// ═══════════════════════════════════════════════════════════════════════
// PYTHON FUNCTIONS DATA
//
// Maps spreadsheet functions to Python code generation rules.
// ═══════════════════════════════════════════════════════════════════════

const pythonFunctions = {
  signatures: {
    NEGATE: [
      { inputs: ['Number'], outputs: ['Number'], code_before: '-(', code_after: ')' }
    ],
    NOT: [
      { inputs: ['Boolean'], outputs: ['Boolean'], code_before: 'not (', code_after: ')' }
    ],
    LEN: [
      { inputs: ['ARRAY[*]'], outputs: ['Number'], code_before: 'len(', code_after: ')' }
    ],
    SIN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.sin(', code_after: ')', _imports: ['math'] }
    ],
    ASIN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.asin(', code_after: ')', _imports: ['math'] }
    ],
    ACOS: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.acos(', code_after: ')', _imports: ['math'] }
    ],
    ATAN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.atan(', code_after: ')', _imports: ['math'] }
    ],
    EXP: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.exp(', code_after: ')', _imports: ['math'] }
    ],
    LN: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.log(', code_after: ')', _imports: ['math'] }
    ],
    FLOOR: [
      { inputs: ['Number'], outputs: ['Number'], code_before: 'math.floor(', code_after: ')', _imports: ['math'] }
    ],
    MOD: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], operator: '%', code_before: '(', code_after: ')' }
    ],
    SUM: [
      { inputs: ['ARRAY[Number]'], outputs: ['Number'], code_before: 'sum(', code_after: ')' }
    ],
    MIN: [
      { inputs: ['ARRAY[Number]'], outputs: ['Number'], code_before: 'min(', code_after: ')' }
    ],
    MAX: [
      { inputs: ['ARRAY[Number]'], outputs: ['Number'], code_before: 'max(', code_after: ')' }
    ],
    AND: [
      { inputs: ['ARRAY[Boolean]'], outputs: ['Boolean'], code_before: 'all(', code_after: ')' }
    ],
    OR: [
      { inputs: ['ARRAY[Boolean]'], outputs: ['Boolean'], code_before: 'any(', code_after: ')' }
    ],
    PRODUCT: [
      { inputs: ['ARRAY[Number]'], outputs: ['Number'], code_before: 'math.prod(', code_after: ')', _imports: ['math'] }
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
      {
        inputs: ['Number', 'Number'], outputs: ['Number'],
        code_before: 'sc_safe_div(', code_after: ')',
        add_functions: ['SC_SAFE_DIV']
      }
    ],
    EXPONENT: [
      { inputs: ['Number', 'Number'], outputs: ['Number'], operator: '**', code_before: '(', code_after: ')' }
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
      { inputs: ['Text', 'Text'], outputs: ['Text'], operator: '+', code_before: '(', code_after: ')' }
    ],
    EQUAL: [
      { inputs: ['Text', 'Text'], outputs: ['Boolean'], operator: '==', code_before: '(', code_after: ')' },
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '==', code_before: '(', code_after: ')' },
      { inputs: ['Boolean', 'Boolean'], outputs: ['Boolean'], operator: '==', code_before: '(', code_after: ')' }
    ],
    NOTEQUAL: [
      { inputs: ['Text', 'Text'], outputs: ['Boolean'], operator: '!=', code_before: '(', code_after: ')' },
      { inputs: ['Number', 'Number'], outputs: ['Boolean'], operator: '!=', code_before: '(', code_after: ')' },
      { inputs: ['Boolean', 'Boolean'], outputs: ['Boolean'], operator: '!=', code_before: '(', code_after: ')' }
    ],
    IF: [
      { inputs: ['Boolean', 'Number', 'Number'], outputs: ['Number'], template: 'IF_TERNARY' },
      { inputs: ['Boolean', 'Text', 'Text'], outputs: ['Text'], template: 'IF_TERNARY' },
      { inputs: ['Boolean', 'Boolean', 'Boolean'], outputs: ['Boolean'], template: 'IF_TERNARY' }
    ],
    AVERAGE: [
      {
        inputs: ['ARRAY[Number]'], outputs: ['Number'],
        code_before: 'sc_average(', code_after: ')',
        add_functions: ['SC_AVERAGE']
      }
    ],
    COUNT: [
      { inputs: ['ARRAY[Number]'], outputs: ['Number'], code_before: 'len(', code_after: ')' }
    ],
  },

  functions: {
    SC_AVERAGE: {
      text: 'def sc_average(arr):\n    return sum(arr) / len(arr)'
    },
    SC_SAFE_DIV: {
      text: 'def sc_safe_div(a, b):\n    return float(\'inf\') if b == 0 else (a / b)'
    },
  },

  templates: {
    IF_TERNARY: {
      'force-persist': false,
      'no-persist-template': '(<input2> if <input1> else <input3>)'
    }
  },

  transforms: {},
  function_logic_dags: {}
};

// ═══════════════════════════════════════════════════════════════════════
// OVERRIDES SOURCE
// ═══════════════════════════════════════════════════════════════════════

const overridesSource = `{
  // Custom function overrides for Python.
  //
  // When a spreadsheet function has an override here, the transpiler
  // emits a simple function call and prepends your hand-written
  // Python implementation instead of expanding the DAG.
  //
  // Example:
  //   "CALCULATE_TAX": "def CALCULATE_TAX(income, rate):\\n    return income * rate"
}`;

// ═══════════════════════════════════════════════════════════════════════
// BUILD
// ═══════════════════════════════════════════════════════════════════════

const syntaxSource = serializeSyntaxObject(PYTHON_SYNTAX, PYTHON_SYNTAX_ANNOTATIONS);

const pack = {
  type: 'sc-language-pack',
  version: '1.0',
  meta: {
    name: 'Python',
    description: 'Example Python language pack — generates Python 3 code from standard and loop sheets. Does not support date operations.',
    fileExtension: '.py'
  },
  syntax: syntaxSource,
  functions: pythonFunctions,
  overrides: overridesSource
};

const outPath = join(__dirname, 'python-language-pack.json');
writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');
console.log(`Written: ${outPath}`);
