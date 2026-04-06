/**
 * @file Canonical Function Signatures
 * @description The single source of truth for built-in function type signatures.
 *
 * Each system attaches its own behavior to these signatures:
 * - Calc engine (utils/functions.js) attaches runtime `impl` functions
 * - JS transpiler (transpiler/data/javascriptFunctions.js) attaches codegen templates
 * - Future language packs import these signatures and bring their own codegen
 *
 * Language packs are independent modules — they import signatures from here
 * and add their own code generation, rather than being fields on a shared object.
 */

/**
 * Built-in function type signatures.
 *
 * Each function maps to an array of signature variants:
 *   { inputs: string[], output: string }
 *
 * Variant order matters — more specific signatures should come first
 * (e.g., Date before Number for overloaded arithmetic).
 */
const functionSignatures = {

  // ── Special functions ────────────────────────────────────────────────

  PROCEED: [
    { inputs: ['Boolean'], output: 'Boolean' },
    { inputs: ['Number'], output: 'Number' },
    { inputs: ['Date'], output: 'Date' },
    { inputs: ['Datetime'], output: 'Datetime' },
    { inputs: ['Text'], output: 'Text' },
  ],

  NEGATE: [
    { inputs: ['Number'], output: 'Number' },
  ],

  INDEX: [
    { inputs: ['Object', 'Number'], output: 'Dynamic' },
    { inputs: ['Object', 'Text'], output: 'Dynamic' },
    { inputs: ['ARRAY[Number]', 'Number'], output: 'Number' },
    { inputs: ['ARRAY[Text]', 'Number'], output: 'Text' },
    { inputs: ['ARRAY[Boolean]', 'Number'], output: 'Boolean' },
    { inputs: ['ARRAY[Date]', 'Number'], output: 'Date' },
    { inputs: ['ARRAY[Datetime]', 'Number'], output: 'Datetime' },
  ],

  // ── Arithmetic ───────────────────────────────────────────────────────

  ADD: [
    { inputs: ['Number', 'Number'], output: 'Number' },
    { inputs: ['Date', 'Number'], output: 'Date' },
    { inputs: ['Number', 'Date'], output: 'Date' },
    { inputs: ['Datetime', 'Number'], output: 'Datetime' },
    { inputs: ['Number', 'Datetime'], output: 'Datetime' },
  ],

  SUBTRACT: [
    { inputs: ['Number', 'Number'], output: 'Number' },
    { inputs: ['Date', 'Number'], output: 'Date' },
    { inputs: ['Date', 'Date'], output: 'Number' },
    { inputs: ['Datetime', 'Number'], output: 'Datetime' },
    { inputs: ['Datetime', 'Datetime'], output: 'Number' },
  ],

  MULTIPLY: [
    { inputs: ['Number', 'Number'], output: 'Number' },
  ],

  DIVIDE: [
    { inputs: ['Number', 'Number'], output: 'Number' },
  ],

  EXPONENT: [
    { inputs: ['Number', 'Number'], output: 'Number' },
  ],

  LN: [
    { inputs: ['Number'], output: 'Number' },
  ],

  EXP: [
    { inputs: ['Number'], output: 'Number' },
  ],

  SIN: [
    { inputs: ['Number'], output: 'Number' },
  ],

  FLOOR: [
    { inputs: ['Number'], output: 'Number' },
  ],

  MOD: [
    { inputs: ['Number', 'Number'], output: 'Number' },
  ],

  // ── Comparison ───────────────────────────────────────────────────────

  EQUAL: [
    { inputs: ['Text', 'Text'], output: 'Boolean' },
    { inputs: ['Number', 'Number'], output: 'Boolean' },
    { inputs: ['Boolean', 'Boolean'], output: 'Boolean' },
    { inputs: ['Date', 'Date'], output: 'Boolean' },
    { inputs: ['Datetime', 'Datetime'], output: 'Boolean' },
  ],

  NOTEQUAL: [
    { inputs: ['Text', 'Text'], output: 'Boolean' },
    { inputs: ['Number', 'Number'], output: 'Boolean' },
    { inputs: ['Boolean', 'Boolean'], output: 'Boolean' },
    { inputs: ['Date', 'Date'], output: 'Boolean' },
    { inputs: ['Datetime', 'Datetime'], output: 'Boolean' },
  ],

  LESS: [
    { inputs: ['Number', 'Number'], output: 'Boolean' },
    { inputs: ['Date', 'Date'], output: 'Boolean' },
    { inputs: ['Datetime', 'Datetime'], output: 'Boolean' },
  ],

  GREATER: [
    { inputs: ['Number', 'Number'], output: 'Boolean' },
    { inputs: ['Date', 'Date'], output: 'Boolean' },
    { inputs: ['Datetime', 'Datetime'], output: 'Boolean' },
  ],

  LESSEQUAL: [
    { inputs: ['Number', 'Number'], output: 'Boolean' },
    { inputs: ['Date', 'Date'], output: 'Boolean' },
    { inputs: ['Datetime', 'Datetime'], output: 'Boolean' },
  ],

  GREATEREQUAL: [
    { inputs: ['Number', 'Number'], output: 'Boolean' },
    { inputs: ['Date', 'Date'], output: 'Boolean' },
    { inputs: ['Datetime', 'Datetime'], output: 'Boolean' },
  ],

  // ── Logical ──────────────────────────────────────────────────────────

  IF: [
    { inputs: ['Boolean', 'Boolean', 'Boolean'], output: 'Boolean' },
    { inputs: ['Boolean', 'Number', 'Number'], output: 'Number' },
    { inputs: ['Boolean', 'Date', 'Date'], output: 'Date' },
    { inputs: ['Boolean', 'Datetime', 'Datetime'], output: 'Datetime' },
    { inputs: ['Boolean', 'Text', 'Text'], output: 'Text' },
  ],

  AND: [
    { inputs: ['ARRAY[Boolean]'], output: 'Boolean' },
  ],

  OR: [
    { inputs: ['ARRAY[Boolean]'], output: 'Boolean' },
  ],

  NOT: [
    { inputs: ['Boolean'], output: 'Boolean' },
  ],

  // ── Aggregation ──────────────────────────────────────────────────────

  SUM: [
    { inputs: ['ARRAY[Number]'], output: 'Number' },
  ],

  MIN: [
    { inputs: ['ARRAY[Number]'], output: 'Number' },
  ],

  MAX: [
    { inputs: ['ARRAY[Number]'], output: 'Number' },
  ],

  LEN: [
    { inputs: ['ARRAY[Number]'], output: 'Number' },
    { inputs: ['ARRAY[Text]'], output: 'Number' },
    { inputs: ['ARRAY[Boolean]'], output: 'Number' },
    { inputs: ['ARRAY[Date]'], output: 'Number' },
    { inputs: ['ARRAY[Datetime]'], output: 'Number' },
  ],

};

export { functionSignatures };
