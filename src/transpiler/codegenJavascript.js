/**
 * Transpile DAGs to code.
 *
 * The JAVASCRIPT_SYNTAX object at the top contains ALL language-specific
 * output formatting. To create a new language pack, copy and modify that
 * object. The codegen logic below is language-agnostic — it traverses the
 * DAG and calls lang.xxx() for every piece of output.
 *
 * The syntax object has two sections:
 *
 *   CODEGEN API — methods the generic codegen engine calls directly.
 *   These define the contract between the engine and a language pack.
 *
 *   COMPOSABLE INTERNALS — methods called only by assembleFunction and
 *   renderLoop (not by the engine). Override these to customize behavior
 *   without replacing the orchestrators. If you override assembleFunction
 *   or renderLoop entirely, you may not need these at all.
 */

import * as sig from './signatureRules.js';
import * as nc from './nodeCodegen.js';
import * as validation from './validation.js';
import * as dags from './dagOperations.js';
import { getOrderedParentIds } from './dagOperations.js';
import { requireInt } from './errors.js';

// ═══════════════════════════════════════════════════════════════════════
// LANGUAGE SYNTAX — JavaScript
//
// Everything below this banner is language-specific output formatting.
// A language pack replaces this object. The codegen logic further down
// never hard-codes any output syntax — it always calls through `lang`.
//
// The reference documentation for language pack authors lives in
// JAVASCRIPT_SYNTAX_ANNOTATIONS (below the object) and is emitted as
// comments in the serialized output that appears in the pack editor.
// ═══════════════════════════════════════════════════════════════════════

export const JAVASCRIPT_SYNTAX = {

  // ═══════════════════════════════════════════════════════════════════
  // CODEGEN API
  //
  // Methods the generic codegen engine calls directly. These define
  // the contract between the engine and a language pack — every pack
  // must implement all of these.
  // ═══════════════════════════════════════════════════════════════════

  // ── Values & identifiers ──────────────────────────────────────────

  /** Render a constant value as a code literal. */
  constantValue(value, type) {
    if (type === 'Text') {
      const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `'${escaped}'`;
    }
    if (type === 'Number' || type === 'Date' || type === 'Datetime') return String(value);
    if (type === 'Boolean') return String(value);
    throw new Error(`Unsupported value type: ${type}`);
  },

  /** Make a name safe for use as an identifier. */
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

  /** Generate the internal variable name for a DAG node. */
  variableName(nodeId) {
    return 'var_' + String(nodeId);
  },

  // ── Statements ────────────────────────────────────────────────────

  /** Controls when intermediate variables are created vs expressions inlined. */
  persistConfig: {
    stepCountTradeOff: 5,
    totalStepsThreshold: 25,
    prohibitedTypes: []
  },

  /**
   * Declare and initialize a variable.
   * @param {string} name
   * @param {string} value - the RHS expression
   * @param {string} [type] - data type (e.g. 'Number', 'ARRAY[Text]') for typed languages
   */
  declareVariable(name, value, _type) {
    return `let ${name} = ${value};`;
  },

  /** Return a single value. */
  returnValue(expr) {
    return `return ${expr};`;
  },

  /** Return multiple named values. entries = [{name, expr, type}, ...] */
  returnMultiple(entries) {
    const parts = entries.map(({ name, expr }) => `${name}: ${expr}`);  // type also available on each entry
    return `return { ${parts.join(', ')} };`;
  },

  /** Return an array of values (used by inner iteration DAGs). */
  returnArray(exprs) {
    return `return [${exprs.join(', ')}];`;
  },

  // ── Data structures ───────────────────────────────────────────────

  /** Render an array literal from element expressions. */
  arrayLiteral(elements) {
    return '[' + elements.join(', ') + ']';
  },

  /** Access an object property by string key. */
  objectPropertyAccess(objExpr, key) {
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${objExpr}["${escaped}"]`;
  },

  /** Access an object value by 1-based position. */
  objectPositionAccess(objExpr, position) {
    return `Object.values(${objExpr})[${position - 1}]`;
  },

  /** Access an array element by 1-based position (constant). */
  arrayIndexAccess(arrExpr, position) {
    return `${arrExpr}[${position - 1}]`;
  },

  /** Access an array element by a runtime 1-based index expression. */
  arrayDynamicAccess(arrExpr, indexExpr) {
    return `${arrExpr}[(${indexExpr}) - 1]`;
  },

  // ── Function structure ────────────────────────────────────────────

  /**
   * Assemble a complete function from its parts.
   *
   * The generic codegen produces structured data (body statements, return,
   * helpers) and calls this to produce the final output string. Override
   * for languages with fundamentally different function structure (e.g.
   * SQL's CREATE FUNCTION ... AS $$ ... $$).
   *
   * Default implementation delegates to composable internals:
   * functionHeader, functionFooter, _indentLines.
   *
   * @param {Object} parts
   * @param {string} parts.name - function name (already safe)
   * @param {string[]} parts.argNames - parameter names (already safe)
   * @param {string[]} [parts.argTypes] - parameter data types (for typed languages)
   * @param {string[]} parts.bodyStatements - intermediate declarations (no indent)
   * @param {string} parts.returnStatement - the return statement (no indent)
   * @param {string} [parts.returnType] - return data type (for typed languages)
   * @param {string[]} parts.helpers - helper function definitions
   * @returns {string} complete function code
   */
  // parts: { name, argNames, argTypes, bodyStatements, returnStatement, returnType, helpers }
  // argTypes/returnType: available for typed languages (see formatType)
  assembleFunction({ name, argNames, bodyStatements, returnStatement, helpers }) {
    const header = this.functionHeader(name, argNames);
    const indented = this._indentLines([...bodyStatements, returnStatement]);
    const body = indented.join('\n');

    let code = '';
    if (helpers.length > 0) {
      code += helpers.join('\n') + '\n\n';
    }
    code += header + '\n' + body + '\n' + this.functionFooter() + '\n';
    return code;
  },

  /**
   * Render a loop node from pre-computed loop data.
   *
   * This is the structural template for imperative loop codegen.
   * For imperative languages, this often works unchanged — override the
   * composable internals it delegates to instead.
   * For non-imperative targets (SQL, functional), override this entirely.
   *
   * Default implementation delegates to composable internals:
   * declareVariable, declareUninitializedVariable, assignVariable,
   * arrayLiteral, arrayPush, ifReturn, ifBreak, functionCall,
   * destructureArray, wrapInfiniteLoop, wrapLoopExpression,
   * loopReturnStatement.
   *
   * @param {Object} loop - Pre-computed loop data:
   *   - maxIterations: number|undefined (from XML maxIterations attribute)
   *   - iterationFuncName: string
   *   - registers: [{ name, newName, initExpr, type }]
   *   - outputOnlyCols: [{ name, newName, initExpr|null, type|null }]
   *   - externalExprs: string[]
   *   - stop0Expr: string|null
   *   - outputCols: [{ col, name, outputName, isAllMode, accName, type|null }]
   *   - iterationBody: { bodyStatements, returnParts, stopExpr, inputNames, inputTypes } | null
   *     Raw iteration body pieces for languages that inline the body (e.g. SQLite).
   *     returnParts are the output expressions (one per register + output-only col),
   *     stopExpr is the stop boolean expression. All expressions reference inputNames
   *     as bare identifiers. null if no iteration body was transpiled.
   * @returns {string | { preamble: string[], expression: string }}
   *   Either a code expression string (e.g. JS IIFE), or an object with
   *   preamble statements that must precede the expression. Use the object
   *   form for languages that can't express loops as inline expressions
   *   (e.g. Python emits a nested def, then calls it).
   */
  renderLoop(loop) {
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
      const accType = col.type ? `ARRAY[${col.type}]` : null;
      bodyLines.push(this.declareVariable(col.accName, this.arrayLiteral([]), accType));
    }

    // Iteration counter for max iterations guard
    if (loop.maxIterations != null) {
      bodyLines.push(this.declareVariable('_iter', '0', 'Number'));
    }

    // Early return if stop0 is true (while-do semantics)
    if (loop.stop0Expr) {
      bodyLines.push(this.ifReturn(loop.stop0Expr, this.loopReturnStatement(loop)));
    }

    // Build while-loop body
    const whileBody = [];

    // Max iterations guard
    if (loop.maxIterations != null) {
      whileBody.push(`if (++_iter > ${loop.maxIterations}) throw new Error('Loop exceeded max iterations (${loop.maxIterations})');`);
    }

    // Call iteration function, destructure results
    const iterArgs = [
      ...loop.registers.map(r => r.name),
      ...loop.externalExprs,
    ];
    const returnVars = [
      ...loop.registers.map(r => r.newName),
      ...loop.outputOnlyCols.map(c => c.newName),
      'stop',
    ];
    const returnVarTypes = [
      ...loop.registers.map(r => r.type),
      ...loop.outputOnlyCols.map(c => c.type),
      'Boolean',
    ];
    whileBody.push(this.destructureArray(
      returnVars,
      this.functionCall(loop.iterationFuncName, iterArgs),
      returnVarTypes,
    ));

    // Update registers
    for (const reg of loop.registers) {
      whileBody.push(this.assignVariable(reg.name, reg.newName));
    }

    // Update output-only columns
    for (const col of loop.outputOnlyCols) {
      whileBody.push(this.assignVariable(col.name, col.newName));
    }

    // Push to accumulators
    for (const col of allModeCols) {
      whileBody.push(this.arrayPush(col.accName, col.name));
    }

    // Break check
    whileBody.push(this.ifBreak('stop'));

    // Wrap while body in infinite loop, add to body lines
    bodyLines.push(...this.wrapInfiniteLoop(whileBody));

    // Final return
    bodyLines.push(this.loopReturnStatement(loop));

    // Wrap everything in a loop expression (IIFE for JS)
    return this.wrapLoopExpression(bodyLines).join('\n');
  },

  // ── Engine hooks ──────────────────────────────────────────────────

  /**
   * Auto-generate call syntax for custom spreadsheet functions.
   *
   * Custom spreadsheet functions (is_helper_function=true) are registered
   * at transpile time, so their call syntax can't be pre-written in the
   * functions file. This generates the standard call pattern:
   * FUNC_NAME(arg1, arg2, ...)
   */
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

  /** Post-processing after generating code for a node (e.g. track used helpers). */
  afterCodeNode(ctx, _G, _nodeId, functionSignature) {
    if (functionSignature.add_functions) {
      ctx.usedFunctions = new Set([
        ...ctx.usedFunctions,
        ...functionSignature.add_functions,
      ]);
    }
  },

  /** Return initial language-specific context state (merged into ctx). */
  initContext() {
    return {};
  },

  /**
   * Wrap the final generated code in module-level boilerplate.
   *
   * Called once at the end of transpileDags, after all functions are generated.
   * Use for imports, class wrappers, module declarations, etc.
   * JS is identity — no module wrapping needed.
   *
   * @param {string} code - the complete generated code
   * @returns {string} wrapped code
   */
  wrapModule(code) {
    return code;
  },

  // ═══════════════════════════════════════════════════════════════════
  // COMPOSABLE INTERNALS
  //
  // These methods are NOT called by the codegen engine. They are called
  // only by assembleFunction and renderLoop (above). Override them to
  // customize those orchestrators without replacing them entirely.
  //
  // If you override assembleFunction or renderLoop, you may not need
  // any of these.
  // ═══════════════════════════════════════════════════════════════════

  // ── Used by safeName ──────────────────────────────────────────────

  reservedWords: new Set([
    'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof',
    'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
    'void', 'while', 'with', 'class', 'const', 'enum', 'export', 'extends',
    'import', 'super', 'implements', 'interface', 'let', 'package', 'private',
    'protected', 'public', 'static', 'yield', 'await', 'async',
  ]),

  // ── Used by assembleFunction ──────────────────────────────────────

  indent: '  ',

  /** Generate a function header line. */
  functionHeader(name, argNames) {
    return `function ${name}(${argNames.join(', ')}) {`;
  },

  /** Generate a function footer line. */
  functionFooter() {
    return '}';
  },

  // ── Used by renderLoop ────────────────────────────────────────────

  /**
   * Declare a variable without a value.
   * @param {string} name
   * @param {string} [type] - data type for typed languages
   */
  declareUninitializedVariable(name, _type) {
    return `let ${name};`;
  },

  /** Reassign an existing variable. */
  assignVariable(name, value) {
    return `${name} = ${value};`;
  },

  /** Conditional early return. */
  ifReturn(condExpr, returnStatement) {
    return `if (${condExpr}) ${returnStatement}`;
  },

  /** Conditional break from a loop. */
  ifBreak(condExpr) {
    return `if (${condExpr} !== false) break;`;
  },

  /** Generate a function call expression. */
  functionCall(name, argExprs) {
    return `${name}(${argExprs.join(', ')})`;
  },

  /** Append a value to an array (statement). */
  arrayPush(arrExpr, valExpr) {
    return `${arrExpr}.push(${valExpr});`;
  },

  /**
   * Destructure an array into named variables.
   * @param {string[]} varNames
   * @param {string} rhsExpr
   * @param {string[]} [varTypes] - per-variable data types (for typed languages)
   */
  destructureArray(varNames, rhsExpr, _varTypes) {
    return `let [${varNames.join(', ')}] = ${rhsExpr};`;
  },

  /**
   * Wrap loop body in an expression context.
   *
   * JS uses an IIFE to make statements act as an expression.
   * Languages that can't do this should override renderLoop instead
   * and return { preamble, expression } (see renderLoop's JSDoc).
   *
   * @param {string[]} bodyLines - lines of code (no leading indentation)
   * @returns {string[]} wrapped lines
   */
  wrapLoopExpression(bodyLines) {
    const indented = this._indentLines(bodyLines);
    return ['(() => {', ...indented, '})()'];
  },

  /**
   * Wrap body lines in an infinite loop construct.
   *
   * @param {string[]} bodyLines - lines of code (no leading indentation)
   * @returns {string[]} wrapped lines (header + indented body + footer)
   */
  wrapInfiniteLoop(bodyLines) {
    const indented = this._indentLines(bodyLines);
    return ['while (true) {', ...indented, '}'];
  },

  /**
   * Build the return statement for a loop's output values.
   * Handles single vs multiple outputs and all-mode accumulators.
   *
   * @param {Object} loop - the loop data object (see renderLoop)
   * @returns {string} a complete return statement
   */
  loopReturnStatement(loop) {
    const entries = loop.outputCols.map(col => ({
      name: col.outputName,
      expr: col.isAllMode ? col.accName : col.name,
    }));
    if (entries.length === 1) {
      return this.returnValue(entries[0].expr);
    }
    return this.returnMultiple(entries);
  },

  // ── Used by assembleFunction (for typed languages) ──────────────

  /**
   * Map a spreadsheet type string to a language-specific type annotation.
   * Identity for JS — override for typed languages.
   *
   * @param {string} type - e.g. 'Number', 'Text', 'ARRAY[Number]'
   * @returns {string} language-specific type string
   */
  formatType(type) {
    return type;
  },

  // ── Shared internal helpers ───────────────────────────────────────

  /**
   * Indent an array of lines by one level. Handles multi-line strings
   * from primitives (e.g. Python's `if cond:\n    break`) by splitting
   * on newlines before indenting.
   */
  _indentLines(lines) {
    return lines
      .flatMap(line => line.split('\n'))
      .map(line => line === '' ? '' : this.indent + line);
  },
};

/**
 * Section annotations for JAVASCRIPT_SYNTAX serialization.
 *
 * Maps property names to comment text that should appear before them
 * in the serialized output. This preserves the CODEGEN API / COMPOSABLE
 * INTERNALS structure and reference documentation when the syntax object
 * is displayed in the language pack editor.
 */
export const JAVASCRIPT_SYNTAX_ANNOTATIONS = {
  constantValue: [
    '═══════════════════════════════════════════════════════════════',
    'CODEGEN API',
    '',
    'Methods the generic codegen engine calls directly. These define',
    'the contract between the engine and a language pack — every pack',
    'must implement all of these.',
    '═══════════════════════════════════════════════════════════════',
    '',
    'OBJECT CONTEXT — the syntax object\'s methods can reference each',
    'other via `this`. For example, assembleFunction calls',
    'this.functionHeader(), this._indentLines(), etc. Any property',
    'on the object is accessible via `this`.',
    '',
    'ENGINE LIFECYCLE — the engine calls syntax methods in this order:',
    '',
    '  1. initContext()        — once, before codegen starts.',
    '                            Returns properties merged into ctx.',
    '  2. addCallMechanics()   — once, with the full conversion rules.',
    '                            Sets up call syntax for custom functions.',
    '  3. Per DAG node (in topological order):',
    '       constantValue()    — for constant nodes',
    '       safeName()         — for input nodes',
    '       variableName()     — for persisted node references',
    '       declareVariable()  — when a node is persisted',
    '       afterCodeNode()    — after each function node\'s code is generated',
    '       (+ data structure methods for INDEX/ARRAY nodes)',
    '  4. assembleFunction()   — once per function, with all parts collected.',
    '     OR renderLoop()      — for LOOP nodes, with pre-computed loop data.',
    '  5. wrapModule()         — once at the very end, wrapping all output.',
    '',
    '  The context object (ctx) flows through steps 1-5 and carries:',
    '    ctx.lang              — reference to this syntax object',
    '    ctx.usedFunctions     — Set of helper function keys encountered',
    '    ctx.pendingStatements — statements from renderLoop preambles',
    '    ctx.expandedLoopInnerCode — inner iteration function code',
    '    + any properties returned by initContext()',
    '',
    'EXAMPLE — for a spreadsheet function A + B:',
    '  1. Engine sees two input nodes → calls safeName(\'a\'), safeName(\'b\')',
    '  2. Engine sees ADD function node → looks up ADD in functions data,',
    '     finds operator "+" with code_before "(" and code_after ")"',
    '     → produces "(a + b)"',
    '  3. If the node is persisted → declareVariable(\'var_3\', \'(a + b)\', \'Number\')',
    '     → "let var_3 = (a + b);"',
    '  4. For the output → returnValue(\'var_3\') → "return var_3;"',
    '  5. assembleFunction({ name, argNames, bodyStatements, returnStatement, ... })',
    '     → wraps everything in a function',
    '',
    'NODE TYPES — each DAG node is one of:',
    '  input    → a function parameter. Engine calls safeName(input_name).',
    '  constant → a literal value. Engine calls constantValue(value, type).',
    '  function → a computation. Engine resolves via the functions data',
    '             file (signatures, templates, operators), or for built-in',
    '             structural functions (ARRAY, INDEX, LOOP) dispatches to',
    '             specific syntax methods.',
    '',
    'DATA TYPES — every node has a data_type, passed as the `type` param:',
    '  Number, Text, Boolean, Date',
    '  ARRAY[T]    — e.g. ARRAY[Number], ARRAY[Text]',
    '  Object[...] — keyed collection (multi-output functions)',
    '',
    'FUNCTION STRUCTURE — the engine builds functions in two steps:',
    '  1. Walk the DAG to produce bodyStatements and a returnStatement.',
    '  2. Call assembleFunction({ name, argNames, argTypes, bodyStatements,',
    '     returnStatement, returnType, helpers }) to format the result.',
    '  Single-output → returnValue(). Multi-output → returnMultiple().',
    '  Inner iteration DAGs (loop bodies) → returnArray() with',
    '  returnType = \'ARRAY\'. Languages without separate function',
    '  definitions (e.g. SQLite) can detect returnType === \'ARRAY\'',
    '  and return \'\' — the iteration body data is also available',
    '  via iterationBody in renderLoop (see renderLoop docs).',
    '',
    'LOOP STRUCTURE — the engine extracts loop metadata into a plain',
    '  data object (strings and booleans, no graph references) and',
    '  calls renderLoop(loop). See renderLoop annotation for the full',
    '  data shape, return types, and strategy guidance.',
    '',
    'VARIABLE PERSISTENCE — controlled by persistConfig. When a node',
    '  is persisted: declareVariable(variableName(nodeId), expr, type).',
    '  Subsequent references use variableName(nodeId) directly.',
    '',
    'INDEX DISPATCH — resolved by data type:',
    '  Object + Text key  → objectPropertyAccess(objExpr, key)',
    '  Object + Number    → objectPositionAccess(objExpr, position)',
    '  ARRAY + Number     → arrayIndexAccess(arrExpr, position)',
    '  Positions are 1-based (as in spreadsheets).',
    '',
    'CUSTOM FUNCTION OVERRIDES — a language pack can provide hand-written',
    '  implementations for specific spreadsheet functions. When an override',
    '  exists for a function, the transpiler skips DAG expansion and emits',
    '  a simple function call instead. The hand-written implementation is',
    '  prepended to the output. Overrides are defined in the pack\'s',
    '  overrides section (a JS object mapping FUNCTION_NAME → code string).',
    '  Use overrides when the DAG-transpiled output is correct but',
    '  unidiomatic — e.g. a 50-line DAG expansion that could be a',
    '  clean 3-line native implementation.',
    '',
    'FUNCTIONS DATA FILE — the other half of a language pack. A JSON',
    'object with these required top-level sections:',
    '',
    '  signatures — maps function names to arrays of type-matched rules.',
    '    Each signature has:',
    '      inputs          — array of type strings for matching (required)',
    '      outputs         — array of return type strings (required)',
    '    Plus ONE of these code generation modes:',
    '      template        — name of a template in the templates section',
    '      operator        — binary infix: code_before + child1 + " op " + child2 + code_after',
    '      code_before/code_after — wrap mode: code_before + children joined with ", " + code_after',
    '    Additional fields:',
    '      add_functions     — array of keys from the functions section to',
    '                          include as helper definitions in the output',
    '      is_helper_function — marks custom spreadsheet functions; call',
    '                          syntax is auto-generated by addCallMechanics',
    '      requires_persist  — forces this node to be assigned to a variable',
    '      no_code           — signature exists for type resolution only',
    '                          (no code generation — throws if reached)',
    '    Matching: first match wins. More specific signatures first.',
    '    Type wildcards: ARRAY[*] matches any ARRAY[T].',
    '',
    '  templates — named template objects referenced by signature template field.',
    '    Each template has:',
    '      no-persist-template — the template string (expression form)',
    '      force-persist       — boolean; if true, forces the node to be',
    '                            persisted (assigned to a variable)',
    '      force-persist-template — optional alternative template for when',
    '                            the node IS persisted (statement form).',
    '                            Can use <var> for the variable name.',
    '    Placeholders in template strings:',
    '      <input1>, <input2>, ... — code expression of the Nth parent (1-based)',
    '      <var>   — the variable name for this node',
    '      <value> — the code expression for this node itself',
    '',
    '  functions — helper function definitions.',
    '    Each entry has:',
    '      text — the literal function definition string, injected into',
    '             the output when referenced by add_functions',
    '',
    '  transforms — required (empty object OK). Populated at runtime',
    '    by the merge system for transform functions.',
    '',
    '  function_logic_dags — required (empty object OK). Populated at',
    '    runtime for custom function type resolution.',
    '',
    '── Values & identifiers ──────────────────────────────────────',
  ].join('\n'),

  persistConfig: [
    '── Statements ──────────────────────────────────────────────',
    '',
    'persistConfig controls when the engine creates intermediate',
    'variables vs inlining expressions.',
    '',
    '  stepCountTradeOff — a node is persisted when the total',
    '    upstream computation steps it saves (by not duplicating',
    '    the subgraph) exceeds this threshold. Lower = more',
    '    variables, higher = more inlining. Default 5 for JS.',
    '',
    '  totalStepsThreshold — after the step-count optimization,',
    '    any remaining subgraph exceeding this many total steps',
    '    is further reduced. Acts as a ceiling. Default 25 for JS.',
    '',
    '  prohibitedTypes — data types that should never be stored',
    '    in variables (e.g., if a language can\'t assign certain',
    '    types). Default [] (no restrictions).',
  ].join('\n'),

  arrayLiteral: '── Data structures ─────────────────────────────────────────',

  assembleFunction: [
    '── Function structure ──────────────────────────────────────────',
    '',
    'assembleFunction and renderLoop are the two "orchestrator" methods.',
    'They delegate to composable internals (below). For imperative',
    'languages, override the internals. For structurally different',
    'targets (SQL, functional), override the orchestrators.',
    '',
    'assembleFunction is called for:',
    '  - The main (root) function of the spreadsheet',
    '  - Inner iteration body functions (loop bodies)',
    '',
    'For iteration body functions, returnType will be \'ARRAY\' — the',
    'body returns [register1, register2, ..., stopBoolean]. Languages',
    'that don\'t support separate function definitions (e.g. SQLite)',
    'can detect returnType === \'ARRAY\' and return \'\' — the raw',
    'iteration body data is also passed to renderLoop via',
    'loop.iterationBody (see renderLoop docs).',
    '',
    'helpers: array of helper function definition strings. These are',
    'collected from functions data entries referenced by add_functions',
    'in matched signatures. They should be emitted before the function.',
  ].join('\n'),

  renderLoop: [
    '── Loop rendering ─────────────────────────────────────────────',
    '',
    'renderLoop receives a pre-computed data object with all loop',
    'metadata as strings — no graph references. The engine extracts',
    'everything from the DAG before calling this method.',
    '',
    'LOOP OBJECT SHAPE:',
    '',
    '  loop.maxIterations: number | undefined',
    '    Max iterations from the XML. Use for safety guards or',
    '    to know how many times to unroll.',
    '',
    '  loop.iterationFuncName: string',
    '    Safe name of the iteration body function. For languages',
    '    that emit the body as a callable function (JS, Python),',
    '    call this name. For languages that inline the body',
    '    (SQLite), this is informational only.',
    '',
    '  loop.registers: [{ name, newName, initExpr, type }]',
    '    Loop registers — variables that carry state between',
    '    iterations. name is the current value, newName is the',
    '    updated value returned by the iteration body.',
    '    initExpr is the initial value (code expression).',
    '    type is the data type (e.g. \'Number\').',
    '',
    '  loop.outputOnlyCols: [{ name, newName, initExpr|null, type|null }]',
    '    Columns that appear in the output but are not fed back',
    '    as inputs to the next iteration. Same shape as registers.',
    '',
    '  loop.externalExprs: string[]',
    '    Code expressions for values passed into the iteration',
    '    body that are constant across iterations (e.g. a tax rate).',
    '    These are the arguments after the registers.',
    '',
    '  loop.stop0Expr: string | null',
    '    If non-null, a code expression for the initial stop',
    '    condition (checked before the first iteration — "while-do"',
    '    semantics). If the loop should always run at least once,',
    '    this is null.',
    '',
    '  loop.outputCols: [{ col, name, outputName, isAllMode, accName, type|null }]',
    '    Columns to include in the final result. outputName is the',
    '    user-facing key. isAllMode means the output collects ALL',
    '    iteration values (not just the final one) — accName is the',
    '    accumulator variable for that column.',
    '',
    '  loop.iterationBody: object | null',
    '    Raw iteration body data. null if no iteration body was',
    '    transpiled (shouldn\'t happen in practice).',
    '',
    '    IMPORTANT: This is the key to inlining strategies. The',
    '    engine transpiles the iteration body through the normal',
    '    codegen pipeline (calling your declareVariable, etc.) and',
    '    passes the results here. Languages that emit a separate',
    '    iteration function (JS, Python) can ignore this — they',
    '    call iterationFuncName instead. Languages that inline the',
    '    body (SQLite, because it has no CREATE FUNCTION) use this',
    '    to get at the body\'s structure.',
    '',
    '    iterationBody.bodyStatements: string[]',
    '      Intermediate variable declarations from the iteration',
    '      body, already rendered through your declareVariable().',
    '      These are the computation steps inside one iteration.',
    '',
    '    iterationBody.returnParts: string[]',
    '      Code expressions for the iteration outputs — one per',
    '      register, then one per output-only column. These are',
    '      what the iteration body "returns" (the new values for',
    '      the next iteration).',
    '',
    '    iterationBody.stopExpr: string',
    '      Code expression for the stop condition — evaluates to',
    '      a boolean. When true, the loop should stop.',
    '',
    '    iterationBody.inputNames: string[]',
    '      Parameter names used inside the body. Order:',
    '      [register1, register2, ..., external1, external2, ...].',
    '      When inlining, you\'ll need to substitute these names',
    '      with your actual variable/column names.',
    '',
    '    iterationBody.inputTypes: string[]',
    '      Data types corresponding to inputNames.',
    '',
    'RETURN TYPES:',
    '',
    '  string — an inline expression. Use when the language can',
    '    express the entire loop as a single expression.',
    '    JS uses an IIFE: (() => { let x = 0; while(true) {...}; return x; })()',
    '',
    '  { preamble: string[], expression: string } — for languages',
    '    that need to emit statements before the expression.',
    '    The preamble lines are injected into the parent function\'s',
    '    body at the current position. The expression is used where',
    '    the loop value is referenced.',
    '    Python: preamble is a nested def, expression is the call.',
    '    SQLite: preamble is ALTER/UPDATE statements, expression is',
    '    a column reference.',
    '',
    'STRATEGY GUIDANCE:',
    '',
    '  If your language has functions, variables, and loops:',
    '    The default renderLoop (using composable internals) likely',
    '    works. Override the internals to customize syntax.',
    '    Ignore loop.iterationBody — call iterationFuncName instead.',
    '',
    '  If your language has variables and loops but no functions:',
    '    Override renderLoop. Use loop.iterationBody to inline the',
    '    body directly. Substitute iterationBody.inputNames with',
    '    your variable names. Return { preamble, expression }.',
    '',
    '  If your language has no loops (e.g. SQL):',
    '    Override renderLoop. Use loop.iterationBody and',
    '    loop.maxIterations to unroll — repeat the body statements',
    '    maxIterations times, guarding each iteration with the stop',
    '    condition. Return { preamble, expression }.',
    '',
    '  Also set assembleFunction to return \'\' when',
    '  returnType === \'ARRAY\' if you\'re inlining the body — the',
    '  iteration function definition is not needed.',
  ].join('\n'),

  addCallMechanics: [
    '── Engine hooks ────────────────────────────────────────────',
    '',
    'initContext is called once before codegen starts. Return an',
    'object whose properties are merged into the codegen context',
    '(ctx). Use this to initialize language-specific tracking',
    'state. The context is passed to afterCodeNode on every node.',
    '',
    'The JS pack uses ctx.usedFunctions (a Set) to track which',
    'helper functions need to be included in the output.',
    'afterCodeNode adds to this set when a signature has',
    'add_functions. collectHelpers then reads it to build the',
    'helpers array for assembleFunction.',
    '',
    'A Python pack might use ctx to track import statements',
    'needed, then emit them in wrapModule.',
    '',
    'addCallMechanics is called once before codegen, with the',
    'full conversion rules (including custom function signatures).',
    'Its job: ensure every custom spreadsheet function (marked',
    'is_helper_function in its signature) has code_before/code_after',
    'set for call syntax.',
    '',
    'The default implementation generates standard call syntax:',
    '  FUNC_NAME(arg1, arg2)',
    '',
    'Override for languages with different call conventions:',
    '  Ruby:  func_name arg1, arg2',
    '  Lisp:  (func-name arg1 arg2)',
    '',
    'wrapModule is called once at the very end, wrapping all',
    'generated code. Use for module-level boilerplate.',
    '',
    '  Python: add \'import math\\n\\n\' at the start',
    '  SQL:    wrap in CREATE FUNCTION ... AS $$ ... $$ LANGUAGE plpgsql;',
    '  TypeScript: add \'export \' before each function',
  ].join('\n'),

  reservedWords: [
    '═══════════════════════════════════════════════════════════════',
    'COMPOSABLE INTERNALS',
    '',
    'These methods are NOT called by the codegen engine. They are',
    'called only by assembleFunction and renderLoop (above). Override',
    'them to customize those orchestrators without replacing them.',
    '',
    'If you override assembleFunction or renderLoop entirely, you',
    'may not need any of these.',
    '═══════════════════════════════════════════════════════════════',
    '',
    '── Used by safeName ────────────────────────────────────────────',
  ].join('\n'),

  indent: '── Used by assembleFunction ─────────────────────────────────',

  declareUninitializedVariable: '── Used by renderLoop ──────────────────────────────────────',

  formatType: [
    '── Used by assembleFunction (for typed languages) ─────────',
    '',
    'formatType maps spreadsheet type strings to language-specific',
    'type annotations.',
    '',
    '  Spreadsheet types: Number, Text, Boolean, Date,',
    '    ARRAY[T] (e.g. ARRAY[Number]), Object[T1, T2, ...]',
    '',
    '  Override for typed languages:',
    '    Python:     Number → float, Text → str, ARRAY[Number] → list[float]',
    '    TypeScript: Number → number, Text → string, ARRAY[Number] → number[]',
    '    SQL:        Number → NUMERIC, Text → TEXT, ARRAY[Number] → NUMERIC[]',
    '',
    '  Call via this.formatType(type) in assembleFunction,',
    '  declareVariable, functionHeader, or any other method',
    '  that needs type annotations.',
  ].join('\n'),

  _indentLines: '── Shared internal helpers ──────────────────────────────────',
};


// ═══════════════════════════════════════════════════════════════════════
// GENERIC CODEGEN — language-agnostic
//
// Everything below traverses the DAG and calls lang.xxx() for output.
// None of this code contains language-specific strings.
// ═══════════════════════════════════════════════════════════════════════

// ── Codegen context ──────────────────────────────────────────────────

function createCodegenContext(lang) {
  return {
    usedFunctions: new Set(),
    expandedLoopInnerCode: [],
    lang,
    ...lang.initContext(),
  };
}

// ── Helper collection ────────────────────────────────────────────────

function collectHelpers(ctx, conversionRules) {
  const helpers = [];
  for (const func of ctx.usedFunctions) {
    if (func in (conversionRules.functions || {})) {
      helpers.push(conversionRules.functions[func].text);
    }
  }
  return helpers;
}

/**
 * Find custom function overrides actually used in the DAG.
 * Returns the override code strings for functions that appear as
 * call nodes (i.e. were not expanded because of the override).
 */
function collectUsedOverrides(G, overrides) {
  const used = new Set();
  for (const nodeId of G.nodeIds()) {
    const node = G.getNode(nodeId);
    if (node.node_type === 'function') {
      const funcName = (node.function_name || '').toUpperCase();
      if (funcName in overrides) {
        used.add(funcName);
      }
    }
  }
  return [...used].sort().map(name => overrides[name]);
}

// ── Placeholder resolution ───────────────────────────────────────────

function getPlaceholderVal(ctx, placeholderKey, G, nodeId, conversionRules) {
  const lang = ctx.lang;
  if (placeholderKey === 'var') {
    return lang.variableName(nodeId);
  }
  if (placeholderKey === 'value') {
    return codeNode(ctx, G, nodeId, true, conversionRules);
  }
  if (placeholderKey.startsWith('input')) {
    const inputNumber = parseInt(placeholderKey.slice(5), 10) - 1;
    const parents = getOrderedParentIds(G, nodeId);
    if (inputNumber < parents.length) {
      return codeNode(ctx, G, parents[inputNumber], false, conversionRules);
    }
    throw new Error(`Input ${inputNumber + 1} not found for node ${nodeId}`);
  }
  throw new Error(`Unknown placeholder: ${placeholderKey}`);
}

// ── Node code generation ─────────────────────────────────────────────

function codeNode(ctx, G, nodeId, isPrimary, conversionRules) {
  const lang = ctx.lang;
  const attribs = G.getNode(nodeId);
  const nodeType = attribs.node_type;
  const dataType = attribs.data_type;

  if (nodeType === 'input') {
    return lang.safeName(attribs.input_name);
  }

  if (nodeType === 'constant') {
    return lang.constantValue(attribs.value, dataType);
  }

  if (nodeType === 'function') {
    if (attribs.persist && !isPrimary) {
      return lang.variableName(nodeId);
    }
    const funcName = attribs.function_name.toUpperCase();

    if (funcName === 'ARRAY') {
      return codeArrayNode(ctx, G, nodeId, conversionRules);
    }
    if (funcName === 'LOOP') {
      return codeLoopNode(ctx, G, nodeId, conversionRules);
    }
    if (funcName === 'INDEX') {
      const parents = getOrderedParentIds(G, nodeId);
      const parentType = G.getNode(parents[0]).data_type || '';

      if (parentType.startsWith('Object[')) {
        const parentCode = codeNode(ctx, G, parents[0], false, conversionRules);
        const keyNode = G.getNode(parents[1]);
        if (keyNode.data_type === 'Text') {
          return lang.objectPropertyAccess(parentCode, keyNode.value);
        }
        return lang.objectPositionAccess(parentCode, requireInt(keyNode.value));
      }
      if (parentType.startsWith('ARRAY[')) {
        const parentCode = codeNode(ctx, G, parents[0], false, conversionRules);
        const keyNode = G.getNode(parents[1]);
        if (keyNode.node_type === 'constant') {
          return lang.arrayIndexAccess(parentCode, requireInt(keyNode.value));
        }
        const keyCode = codeNode(ctx, G, parents[1], false, conversionRules);
        return lang.arrayDynamicAccess(parentCode, keyCode);
      }
    }

    // Standard function node — delegate to nodeCodegen
    const partialCodeNode = (nid) =>
      codeNode(ctx, G, nid, false, conversionRules);
    const partialGetPlaceholder = (placeholderKey) =>
      getPlaceholderVal(ctx, placeholderKey, G, nodeId, conversionRules);
    const partialSpecialProcess = (g, nid, funcSig) =>
      lang.afterCodeNode(ctx, g, nid, funcSig);

    return nc.codeStdFunctionNode(
      G, nodeId, conversionRules,
      partialCodeNode, partialGetPlaceholder, partialSpecialProcess,
      getOrderedParentIds, sig, isPrimary,
    );
  }

  throw new Error(`Unsupported node type: ${nodeType}`);
}

// ── Array nodes ──────────────────────────────────────────────────────

function codeArrayNode(ctx, G, nodeId, conversionRules) {
  const parents = getOrderedParentIds(G, nodeId);
  const elements = parents.map(p => codeNode(ctx, G, p, false, conversionRules));
  return ctx.lang.arrayLiteral(elements);
}

// ── Loop nodes ───────────────────────────────────────────────────────
//
// This function extracts all loop data from the DAG (language-agnostic),
// then hands it to lang.renderLoop() for language-specific rendering.

function codeLoopNode(ctx, G, nodeId, conversionRules) {
  const lang = ctx.lang;
  const attribs = G.getNode(nodeId);

  // If this LOOP node carries its own iteration body (expanded from a
  // cross-sheet loop function), transpile it now so ctx.iterationBody
  // and the iteration function code are available for renderLoop.
  if (attribs.iteration_body_dag) {
    // Save and restore context that transpileInnerDag may clobber —
    // pending statements from earlier LOOP nodes must not be drained
    // into the inner DAG's body statements.
    const savedUsedFunctions = ctx.usedFunctions;
    const savedPendingStatements = ctx.pendingStatements;
    ctx.usedFunctions = new Set();
    ctx.pendingStatements = [];
    const innerCode = transpileInnerDag(ctx, attribs.iteration_body_dag, conversionRules);
    ctx.usedFunctions = savedUsedFunctions;
    ctx.pendingStatements = savedPendingStatements || [];
    if (innerCode.trim()) {
      ctx.expandedLoopInnerCode.push(innerCode);
    }
  }

  const registerCols = attribs.register_cols;
  const outputCol = attribs.output_col;
  const hasStop0 = attribs.has_stop0 || false;

  // Parse parent ordering: register inits, output-only inits, external inputs, [stop0]
  const parents = getOrderedParentIds(G, nodeId);
  const outputOnlyInitCols = attribs.output_only_init_cols || [];
  const numRegisters = registerCols.length;
  const numOutputOnlyInits = outputOnlyInitCols.length;
  const numInits = numRegisters + numOutputOnlyInits;

  const registerInitParents = parents.slice(0, numRegisters);
  const outputOnlyInitParents = parents.slice(numRegisters, numInits);

  let externalInputParents;
  let stop0Parent = null;
  if (hasStop0) {
    externalInputParents = parents.slice(numInits, -1);
    stop0Parent = parents[parents.length - 1];
  } else {
    externalInputParents = parents.slice(numInits);
  }

  // Compute output column metadata
  const outputCols = attribs.output_cols || [outputCol];
  const outputColumnNames = attribs.output_column_names || {};
  const outputModes = attribs.output_modes || {};
  const registerSet = new Set(registerCols);
  const outputOnlyCols = outputCols.filter(col => !registerSet.has(col));

  // Build the loop data object — all DAG traversal and codeNode calls
  // happen here. lang.renderLoop() receives pure data (strings), no DAG.
  const loop = {
    maxIterations: attribs.max_iterations,
    iterationFuncName: lang.safeName(attribs.iteration_dag_name),

    registers: registerCols.map((col, i) => ({
      name: lang.safeName(col.toLowerCase()),
      newName: lang.safeName(`new_${col.toLowerCase()}`),
      initExpr: codeNode(ctx, G, registerInitParents[i], false, conversionRules),
      type: G.getNode(registerInitParents[i]).data_type,
    })),

    outputOnlyCols: outputOnlyCols.map((col, i) => ({
      name: lang.safeName(col.toLowerCase()),
      newName: lang.safeName(`new_${col.toLowerCase()}`),
      initExpr: i < outputOnlyInitParents.length
        ? codeNode(ctx, G, outputOnlyInitParents[i], false, conversionRules)
        : null,
      type: i < outputOnlyInitParents.length
        ? G.getNode(outputOnlyInitParents[i]).data_type
        : null,
    })),

    externalExprs: externalInputParents.map(
      parentId => codeNode(ctx, G, parentId, false, conversionRules)
    ),

    stop0Expr: stop0Parent !== null
      ? codeNode(ctx, G, stop0Parent, false, conversionRules)
      : null,

    outputCols: outputCols.map(col => {
      const regIdx = registerCols.indexOf(col);
      const outIdx = outputOnlyCols.indexOf(col);
      let type = null;
      if (regIdx >= 0) type = G.getNode(registerInitParents[regIdx]).data_type;
      else if (outIdx >= 0 && outIdx < outputOnlyInitParents.length) type = G.getNode(outputOnlyInitParents[outIdx]).data_type;
      return {
        col,
        name: lang.safeName(col.toLowerCase()),
        outputName: outputColumnNames[col] || col,
        isAllMode: outputModes[col] === 'all',
        accName: lang.safeName(`${col.toLowerCase()}_all`),
        type,
      };
    }),

    iterationBody: ctx.iterationBody || null,
  };
  delete ctx.iterationBody;

  const result = lang.renderLoop(loop);

  // renderLoop may return { preamble: string[], expression: string } for
  // languages that can't express loops as inline expressions (e.g. Python
  // uses a nested def + call instead of JS's IIFE). The preamble statements
  // are stashed in ctx and drained at the next statement boundary.
  if (typeof result === 'object' && result.preamble) {
    if (!ctx.pendingStatements) ctx.pendingStatements = [];
    ctx.pendingStatements.push(...result.preamble);
    return result.expression;
  }
  return result;
}

// ── Persist-template detection ────────────────────────────────────────

function usesForcePersistedTemplate(G, nodeId, conversionRules) {
  const attribs = G.getNode(nodeId);
  if (attribs.node_type !== 'function') return false;
  const signature = sig.matchFirstSignatureForNode(G, nodeId, conversionRules);
  if (!signature?.template) return false;
  const templateObj = conversionRules.templates[signature.template];
  return templateObj && 'force-persist-template' in templateObj;
}

// ── Pending statement drain ──────────────────────────────────────────
//
// Some syntax methods (e.g. renderLoop for non-IIFE languages) need to
// emit statements that precede the expression they return. These are
// stashed in ctx.pendingStatements and drained at statement boundaries.

function drainPendingStatements(ctx, bodyStatements) {
  if (ctx.pendingStatements?.length) {
    bodyStatements.push(...ctx.pendingStatements);
    ctx.pendingStatements = [];
  }
}

/**
 * Emit body statements for all persisted nodes in topological order.
 * Shared by transpileInnerDag and convertAndTranspile.
 */
function emitPersistedNodes(ctx, G, sortedNodes, conversionRules) {
  const lang = ctx.lang;
  const bodyStatements = [];

  for (const nodeId of sortedNodes) {
    const nodeAttrs = G.getNode(nodeId);
    if (nodeAttrs.persist) {
      if (usesForcePersistedTemplate(G, nodeId, conversionRules)) {
        const statement = codeNode(ctx, G, nodeId, true, conversionRules);
        drainPendingStatements(ctx, bodyStatements);
        bodyStatements.push(statement);
      } else {
        const vName = lang.variableName(nodeId);
        const expr = codeNode(ctx, G, nodeId, true, conversionRules);
        drainPendingStatements(ctx, bodyStatements);
        bodyStatements.push(lang.declareVariable(vName, expr, nodeAttrs.data_type));
      }
    }
  }

  drainPendingStatements(ctx, bodyStatements);
  return bodyStatements;
}

// ── Inner DAG transpilation ──────────────────────────────────────────

function transpileInnerDag(ctx, innerDag, conversionRules) {
  const lang = ctx.lang;
  const pc = lang.persistConfig;

  dags.markNodesToPersist({
    G: innerDag,
    conversionRules,
    allOutputs: true,
    allArrayNodes: false,
    stepCountTradeOff: pc.stepCountTradeOff,
    totalStepsThreshold: pc.totalStepsThreshold,
    prohibitedTypes: pc.prohibitedTypes,
  });

  const sortedNodes = innerDag.topologicalSort();
  const bodyStatements = emitPersistedNodes(ctx, innerDag, sortedNodes, conversionRules);

  // Build return array: register outputs in order, then stop
  const outputNodeIds = innerDag.graph.output_node_ids;
  const returnParts = [];
  let stopCode = null;

  for (const outId of outputNodeIds) {
    const outName = innerDag.getNode(outId).output_name || '';
    const outCode = codeNode(ctx, innerDag, outId, false, conversionRules);
    if (outName === '_STOP') {
      stopCode = outCode;
    } else {
      returnParts.push(outCode);
    }
  }
  returnParts.push(stopCode || lang.constantValue('false', 'Boolean'));

  // Drain any pending statements generated while building the return expressions
  drainPendingStatements(ctx, bodyStatements);

  const inputNodeIds = innerDag.graph.input_node_ids;
  const inputNames = inputNodeIds.map(
    nid => lang.safeName(innerDag.getNode(nid).input_name)
  );
  const inputTypes = inputNodeIds.map(
    nid => innerDag.getNode(nid).data_type
  );

  // Stash the raw iteration body pieces so codeLoopNode can pass them
  // to renderLoop. Languages that inline the iteration body (e.g. SQLite's
  // WITH RECURSIVE without CREATE FUNCTION) use these instead of calling
  // the iteration function by name.
  ctx.iterationBody = {
    bodyStatements: [...bodyStatements],
    returnParts: returnParts.slice(0, -1), // register/output-only exprs (without stop)
    stopExpr: returnParts[returnParts.length - 1], // the stop boolean expr
    inputNames,
    inputTypes
  };

  return lang.assembleFunction({
    name: lang.safeName(innerDag.graph.name),
    argNames: inputNames,
    argTypes: inputTypes,
    bodyStatements,
    returnStatement: lang.returnArray(returnParts),
    returnType: 'ARRAY',
    helpers: collectHelpers(ctx, conversionRules),
  });
}

// ── Core transpilation ───────────────────────────────────────────────

function convertAndTranspile(G, conversionRules, lang) {
  const ctx = createCodegenContext(lang);
  const outputNodeIds = G.graph.output_node_ids;
  const pc = lang.persistConfig;

  // Transpile inner iteration DAG if present (loop functions)
  let innerFuncCode = '';
  if (G.graph.iteration_body_dag) {
    const innerDag = G.graph.iteration_body_dag;
    innerFuncCode = transpileInnerDag(ctx, innerDag, conversionRules);
    ctx.usedFunctions = new Set();
  }

  dags.markNodesToPersist({
    G,
    conversionRules,
    allOutputs: false,
    allArrayNodes: false,
    stepCountTradeOff: pc.stepCountTradeOff,
    totalStepsThreshold: pc.totalStepsThreshold,
    prohibitedTypes: pc.prohibitedTypes,
  });

  const sortedNodes = G.topologicalSort();
  const bodyStatements = emitPersistedNodes(ctx, G, sortedNodes, conversionRules);

  let returnStatement;
  let returnType;
  if (outputNodeIds.length > 1) {
    const entries = outputNodeIds.map(nodeId => ({
      name: lang.safeName(G.getNode(nodeId).output_name),
      expr: codeNode(ctx, G, nodeId, false, conversionRules),
      type: G.getNode(nodeId).data_type,
    }));
    // Drain pending statements generated while building the return expressions
    // (e.g. a loop node used directly as an output, not persisted)
    drainPendingStatements(ctx, bodyStatements);
    returnStatement = lang.returnMultiple(entries);
    returnType = `Object[${entries.map(e => e.type).join(', ')}]`;
  } else {
    const outputId = outputNodeIds[0];
    returnType = G.getNode(outputId).data_type;
    returnStatement = lang.returnValue(
      codeNode(ctx, G, outputId, false, conversionRules)
    );
    // Drain pending statements generated while building the return expression
    drainPendingStatements(ctx, bodyStatements);
  }

  const graphInputNodeIds = G.graph.input_node_ids;
  const inputNames = graphInputNodeIds.map(
    nid => lang.safeName(G.getNode(nid).input_name)
  );
  const inputTypes = graphInputNodeIds.map(
    nid => G.getNode(nid).data_type
  );

  let code = lang.assembleFunction({
    name: lang.safeName(G.graph.name),
    argNames: inputNames,
    argTypes: inputTypes,
    bodyStatements,
    returnStatement,
    returnType,
    helpers: collectHelpers(ctx, conversionRules),
  });

  // Prepend iteration body definitions — both the graph-level one (same-sheet
  // loop) and any from expanded cross-sheet loop functions.
  const allInnerCode = [
    innerFuncCode,
    ...ctx.expandedLoopInnerCode
  ].filter(c => c.trim()).join('\n\n');
  if (allInnerCode) {
    code = allInnerCode + '\n' + code;
  }

  return code;
}

// ── Loop helper generation ───────────────────────────────────────────

function generateLoopHelperFunctions(G, loopFunctions, conversionRules, lang) {
  const usedLoopFuncs = new Set();
  for (const nodeId of G.nodeIds()) {
    const node = G.getNode(nodeId);
    if (node.node_type === 'function') {
      const funcName = (node.function_name || '').toUpperCase();
      if (funcName in loopFunctions) {
        usedLoopFuncs.add(funcName);
      }
    }
  }

  if (usedLoopFuncs.size === 0) return '';

  const helperDefinitions = [];
  for (const funcName of [...usedLoopFuncs].sort()) {
    const loopData = loopFunctions[funcName];
    const preparedGraph = loopData.graph.copy();

    const [outerDag, innerDag] = dags.transformLoopToOuterInner(
      preparedGraph, loopData.xmlTree, funcName,
    );

    dags.eliminateProceedNodes(outerDag);
    dags.eliminateProceedNodes(innerDag);

    const signatureDefinitionLibrary = sig.initializeConversionRules();
    dags.convertGraph({
      dagToConvert: innerDag,
      conversionRules,
      signatureDefinitionLibrary,
      renumNodes: true,
    });

    outerDag.graph.iteration_body_dag = innerDag;
    const loopCode = convertAndTranspile(outerDag, conversionRules, lang);
    helperDefinitions.push(loopCode);
  }

  return helperDefinitions.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convenience: JavaScript-safe name (for use outside codegen, e.g. test cases).
 */
export function jsSafeName(name) {
  return JAVASCRIPT_SYNTAX.safeName(name);
}

/**
 * Convert a constant value to its JavaScript code representation.
 * (For use outside codegen, e.g. test cases.)
 */
export function constantValueInCode(value, valueType) {
  return JAVASCRIPT_SYNTAX.constantValue(value, valueType);
}

/**
 * Build typed test cases from raw test case elements and a graph.
 *
 * This function is language-agnostic — it parses string test values into
 * typed JS values for test execution. It does NOT generate code.
 *
 * @param {Array} testCases - Raw test cases with { inputValues, outputValues }
 * @param {Object} G - The DAG graph
 * @returns {Array} Typed test cases with { inputs, inputTypes, expectedOutputs, expectedTypes, outputNames }
 */
export function buildTestCases(testCases, G) {
  const graphInputTypes = G.graph.input_node_ids.map(
    (n) => G.getNode(n).data_type
  );

  // Get output names and types from graph
  const outputNodeIds = G.graph.output_node_ids;
  const outputNames = [];
  const graphOutputTypes = [];

  if (outputNodeIds.length === 1) {
    const nodeId = outputNodeIds[0];
    const node = G.getNode(nodeId);
    if (node.function_name === 'LOOP' && node.output_cols) {
      const outputColsForTests = node.output_cols_xml_order || node.output_cols;
      const outputColumnNames = node.output_column_names || {};

      // Parse per-column types from compound data_type (e.g. "Object[Number, Number]")
      let perColTypes = null;
      if (node.data_type?.startsWith('Object[')) {
        perColTypes = node.data_type.slice(7, -1).split(',').map(s => s.trim());
      }

      for (let ci = 0; ci < outputColsForTests.length; ci++) {
        const col = outputColsForTests[ci];
        outputNames.push(jsSafeName(outputColumnNames[col] || col));
        graphOutputTypes.push(perColTypes ? perColTypes[ci] : node.data_type);
      }
    } else {
      outputNames.push(jsSafeName(node.output_name));
      graphOutputTypes.push(node.data_type);
    }
  } else {
    for (const nodeId of outputNodeIds) {
      const node = G.getNode(nodeId);
      outputNames.push(jsSafeName(node.output_name));
      graphOutputTypes.push(node.data_type);
    }
  }

  const cases = [];
  for (let testIdx = 0; testIdx < testCases.length; testIdx++) {
    const testCase = testCases[testIdx];
    const inputs = [];
    const inputElements = testCase.inputValues || [];

    for (let i = 0; i < inputElements.length; i++) {
      const value = inputElements[i].value;
      const dataType = i < graphInputTypes.length ? graphInputTypes[i] : 'Text';

      if (dataType.startsWith('ARRAY[')) {
        // Parse array literal: "{1,2,3}" → [1, 2, 3]
        const innerType = dataType.slice(6, -1);  // e.g., "Number"
        const trimmed = value.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
          throw new Error(
            `Test case ${testIdx + 1}, input ${i + 1}: expected ${dataType} array literal {v1,v2,...} but got '${value}'`
          );
        }
        const elements = trimmed.slice(1, -1).split(',').map(s => s.trim());
        inputs.push(elements.map(el => innerType === 'Number' ? Number(el) : el));
      } else if (dataType === 'Number') {
        const num = parseFloat(value.replace(/\s/g, ''));
        if (isNaN(num)) {
          throw new Error(
            `Test case ${testIdx + 1}, input ${i + 1}: expected Number but got '${value}' which cannot be parsed as a number`
          );
        }
        inputs.push(num);
      } else if (dataType === 'Boolean') {
        if (!['true', 'false'].includes(value.toLowerCase())) {
          throw new Error(
            `Test case ${testIdx + 1}, input ${i + 1}: expected Boolean but got '${value}'`
          );
        }
        inputs.push(value.toLowerCase() === 'true');
      } else {
        inputs.push(value);
      }
    }

    const outputElements = testCase.outputValues || [];
    const expectedOutputs = [];

    for (let i = 0; i < outputElements.length; i++) {
      const value = outputElements[i].value;
      const dataType = i < graphOutputTypes.length ? graphOutputTypes[i] : 'Text';

      if (dataType === 'Number') {
        const num = parseFloat(value.replace(/\s/g, ''));
        if (isNaN(num)) {
          throw new Error(
            `Test case ${testIdx + 1}, output ${i + 1}: expected Number but got '${value}' which cannot be parsed as a number`
          );
        }
        expectedOutputs.push(num);
      } else if (dataType === 'Boolean') {
        if (!['true', 'false'].includes(value.toLowerCase())) {
          throw new Error(
            `Test case ${testIdx + 1}, output ${i + 1}: expected Boolean but got '${value}'`
          );
        }
        expectedOutputs.push(value.toLowerCase() === 'true');
      } else {
        expectedOutputs.push(value);
      }
    }

    cases.push({
      inputs,
      inputTypes: graphInputTypes,
      expectedOutputs,
      expectedTypes: graphOutputTypes,
      outputNames,
    });
  }

  return cases;
}

/**
 * Transpile DAGs to code in the given language.
 *
 * @param {Object} settings - { G, conversionRules, signatureDefinitionLibrary, loopFunctions }
 * @param {Object} [lang=JAVASCRIPT_SYNTAX] - Language syntax object
 * @returns {string} Generated code
 */
export function transpileDags(settings, lang = JAVASCRIPT_SYNTAX) {
  const {
    G,
    signatureDefinitionLibrary,
    loopFunctions = {},
  } = settings;

  if (!validation.isValidConversionRulesDict(settings.conversionRules)) {
    throw new Error('Conversion rules is not valid.');
  }
  if (!validation.isValidSignatureDefinitionDict(signatureDefinitionLibrary, true, true)) {
    throw new Error('Signature definition library is not valid.');
  }

  // Shallow-clone conversionRules with deep-cloned signatures to avoid
  // mutating the caller's object (addCallMechanics adds code_before/code_after)
  const conversionRules = {
    ...settings.conversionRules,
    signatures: structuredClone(settings.conversionRules.signatures || {}),
  };

  lang.addCallMechanics(conversionRules);

  dags.convertGraph({
    dagToConvert: G,
    conversionRules,
    signatureDefinitionLibrary,
    renumNodes: false,
  });

  sig.ifMissingSigsError(conversionRules, G);

  let code = convertAndTranspile(G, conversionRules, lang);

  if (loopFunctions && Object.keys(loopFunctions).length > 0) {
    const helperDefs = generateLoopHelperFunctions(
      G, loopFunctions, conversionRules, lang,
    );
    if (helperDefs) {
      code = helperDefs + '\n\n' + code;
    }
  }

  // Prepend hand-written overrides for custom functions used in this DAG
  const overrides = conversionRules.customFunctionOverrides || {};
  if (Object.keys(overrides).length > 0) {
    const usedOverrides = collectUsedOverrides(G, overrides);
    if (usedOverrides.length > 0) {
      code = usedOverrides.join('\n\n') + '\n\n' + code;
    }
  }

  return lang.wrapModule(code);
}

/** Backwards-compatible entry point — transpile to JavaScript. */
export function transpileDagsToJs(settings) {
  return transpileDags(settings, JAVASCRIPT_SYNTAX);
}

// ═══════════════════════════════════════════════════════════════════════
// SYNTAX OBJECT SERIALIZATION
//
// Round-trip serialization for storing syntax objects in OPFS.
// serializeSyntaxObject → JS source string → reconstructSyntaxObject
// ═══════════════════════════════════════════════════════════════════════

/**
 * Serialize a syntax object to a JS source string that can be stored and
 * later reconstructed via `reconstructSyntaxObject`.
 *
 * Handles functions (via toString()), Sets (via `new Set([...])`), and
 * plain values (via JSON.stringify).
 *
 * @param {Object} syntaxObj - A syntax object (e.g. JAVASCRIPT_SYNTAX)
 * @param {Object} [annotations] - Optional map of property name → comment
 *   string to insert before that property. Use to preserve section headers
 *   and documentation in serialized output.
 * @returns {string} JS source string representing the object literal
 */
export function serializeSyntaxObject(syntaxObj, annotations = {}) {
  const parts = [];
  let needsComma = false;
  for (const [key, val] of Object.entries(syntaxObj)) {
    // Insert annotation comment before this property if one exists
    if (annotations[key]) {
      // Close previous entry with comma before the comment block
      if (needsComma) {
        parts[parts.length - 1] += ',';
        needsComma = false;
      }
      const commentLines = annotations[key]
        .split('\n')
        .map(line => line === '' ? '  //' : `  // ${line}`)
        .join('\n');
      parts.push('\n' + commentLines + '\n');
    } else if (needsComma) {
      parts[parts.length - 1] += ',';
    }

    let serialized;
    if (typeof val === 'function') {
      const fnStr = val.toString();
      // Method shorthand toString() starts with the method name (e.g. "safeName(x) {")
      // and is already valid object literal syntax — don't add "key:" prefix.
      // Arrow functions and "function" keyword need the "key:" prefix.
      const isMethodShorthand = fnStr.startsWith(key + '(') || fnStr.startsWith(key + ' (');
      if (isMethodShorthand) {
        parts.push(`  ${fnStr}`);
      } else {
        parts.push(`  ${key}: ${fnStr}`);
      }
    } else if (val instanceof Set) {
      serialized = `new Set(${JSON.stringify([...val])})`;
      parts.push(`  ${key}: ${serialized}`);
    } else if (typeof val === 'object' && val !== null) {
      serialized = JSON.stringify(val, null, 2).replace(/\n/g, '\n  ');
      parts.push(`  ${key}: ${serialized}`);
    } else {
      serialized = JSON.stringify(val);
      parts.push(`  ${key}: ${serialized}`);
    }
    needsComma = true;
  }
  return `{\n${parts.join('\n')}\n}`;
}

/**
 * Reconstruct a syntax object from a JS source string produced by
 * `serializeSyntaxObject`.
 *
 * @param {string} sourceString - JS source of an object literal
 * @returns {Object} The reconstructed syntax object
 */
export function reconstructSyntaxObject(sourceString) {
  return new Function('return (' + sourceString + ')')();
}

// ── Section-based syntax editing ──────────────────────────────────────

/**
 * Parse a serialized syntax source string into collapsible sections.
 *
 * Splits on annotation comment blocks (lines starting with `  // ═══`
 * or `  // ──`). Each section has a human-readable title extracted from
 * the annotation heading and the raw content (comments + code) for that
 * section.
 *
 * Falls back to a single section if no annotation headings are found.
 *
 * @param {string} source - Full serialized syntax source (including { })
 * @returns {{ title: string, content: string }[]}
 */
export function parseSyntaxSections(source) {
  const inner = source.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  const lines = inner.split('\n');

  // Find contiguous comment blocks (consecutive // lines)
  const commentBlocks = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\/\//.test(lines[i])) {
      const start = i;
      while (i < lines.length && /^\s*\/\//.test(lines[i])) i++;
      commentBlocks.push({ start, end: i });
    } else {
      i++;
    }
  }

  // A section boundary is a comment block that contains ═══ or ── headings.
  // Back up past preceding blank lines to include them in the section.
  const boundaries = [];
  for (const block of commentBlocks) {
    const hasHeading = lines.slice(block.start, block.end)
      .some(l => /^\s*\/\/\s*(═══|──)/.test(l));
    if (!hasHeading) continue;
    let start = block.start;
    while (start > 0 && lines[start - 1].trim() === '') start--;
    boundaries.push(start);
  }

  if (boundaries.length === 0) {
    return [{ title: '', header: '', content: inner }];
  }

  const sections = [];

  // Content before the first annotation (if any)
  if (boundaries[0] > 0) {
    const content = lines.slice(0, boundaries[0]).join('\n');
    if (content.trim()) {
      sections.push({ title: '', header: '', content });
    }
  }

  for (let j = 0; j < boundaries.length; j++) {
    const start = boundaries[j];
    const end = j + 1 < boundaries.length ? boundaries[j + 1] : lines.length;
    const sectionLines = lines.slice(start, end);

    const commentText = sectionLines
      .filter(l => /^\s*\/\//.test(l))
      .map(l => l.replace(/^\s*\/\/\s?/, ''))
      .join('\n');

    // Split into header (leading blank lines + comment block) and content (code).
    // The header is the comment/whitespace preamble that defines the section
    // boundary. It's preserved for round-tripping but hidden in the sections UI.
    let splitIdx = 0;
    for (let k = 0; k < sectionLines.length; k++) {
      const trimmed = sectionLines[k].trim();
      if (trimmed === '' || trimmed.startsWith('//')) {
        splitIdx = k + 1;
      } else {
        break;
      }
    }

    sections.push({
      title: extractSectionTitle(commentText),
      header: sectionLines.slice(0, splitIdx).join('\n'),
      content: sectionLines.slice(splitIdx).join('\n')
    });
  }

  return sections;
}

/**
 * Join parsed syntax sections back into a complete source string.
 *
 * Each section has a header (comment/whitespace preamble) and content (code).
 * Both are reassembled to produce the full source.
 *
 * @param {{ title: string, header: string, content: string }[]} sections
 * @returns {string} Full source string with { } wrapping
 */
export function joinSyntaxSections(sections) {
  return '{' + sections.map(s => {
    if (s.header) return s.header + '\n' + s.content;
    return s.content;
  }).join('\n') + '}';
}

/**
 * Extract a short title from annotation comment text.
 * Looks for ═══-framed headings first, then ── headings, then falls back
 * to the first non-empty line.
 */
function extractSectionTitle(commentText) {
  const lines = commentText.split('\n');

  // ═══-framed heading: title is the first non-empty, non-═══, non-── line after ═══.
  // If only ── lines follow the ═══ banner (header-only annotations), fall through
  // to the ── heading extraction below.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('═══')) {
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (trimmed && !trimmed.includes('═══') && !/^──/.test(trimmed)) {
          return trimmed;
        }
      }
    }
  }

  // ── heading ── pattern
  for (const line of lines) {
    const match = line.match(/──\s+(.+?)\s+──/);
    if (match) return match[1].trim();
  }

  // Fallback
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }

  return 'Section';
}

// ── Reference content extraction ──────────────────────────────────────

/**
 * Extract section-header-only annotations from a full annotations object.
 *
 * Returns a new annotations object where each value contains only the
 * ═══ and ── divider lines (the structural headings), stripped of the
 * longer reference documentation. This is used for the sections view
 * in the pack editor — the full docs live in the Reference tab instead.
 *
 * @param {Object} annotations - e.g. JAVASCRIPT_SYNTAX_ANNOTATIONS
 * @returns {Object} Annotations with only divider/heading lines
 */
export function extractSectionHeaders(annotations) {
  const headers = {};
  for (const [key, text] of Object.entries(annotations)) {
    const lines = text.split('\n');
    const headerLines = lines.filter(l => /^──/.test(l.trim()));
    if (headerLines.length > 0) {
      headers[key] = headerLines.join('\n');
    }
  }
  return headers;
}

/**
 * Format the full annotations object into structured reference content
 * for display in the Reference tab.
 *
 * Returns an array of { title, content } sections, where title is the
 * section heading and content is the documentation text (without the
 * ═══/── decoration).
 *
 * @param {Object} annotations - e.g. JAVASCRIPT_SYNTAX_ANNOTATIONS
 * @returns {{ title: string, content: string }[]}
 */
export function formatReferenceContent(annotations) {
  const sections = [];

  for (const text of Object.values(annotations)) {
    const lines = text.split('\n');

    // Find section boundaries within this annotation — each ═══ or ──
    // heading starts a new reference section.
    let currentTitle = null;
    let currentLines = [];

    function flush() {
      if (currentTitle !== null) {
        const content = currentLines.join('\n').trim();
        if (content) {
          sections.push({ title: currentTitle, content });
        }
      }
    }

    for (const line of lines) {
      const trimmed = line.trim();

      // ═══ banner line — marks a major section boundary
      if (/^═══/.test(trimmed)) {
        // Skip the ═══ line itself — the title is the next non-empty line
        continue;
      }

      // ── heading ── pattern — subsection
      const subMatch = trimmed.match(/^──\s+(.+?)\s*──*\s*$/);
      if (subMatch) {
        flush();
        currentTitle = subMatch[1].trim();
        currentLines = [];
        continue;
      }

      // If we haven't found any heading yet, check if this is a title
      // line after a ═══ banner (e.g. "CODEGEN API")
      if (currentTitle === null && trimmed && !/^──/.test(trimmed)) {
        flush();
        currentTitle = trimmed;
        currentLines = [];
        continue;
      }

      currentLines.push(line);
    }

    flush();
  }

  return sections;
}
