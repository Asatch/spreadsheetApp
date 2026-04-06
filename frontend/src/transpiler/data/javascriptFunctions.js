/**
 * JavaScript function signatures and code generation rules.
 *
 * This file maps spreadsheet functions to JavaScript code. It's one half of
 * a language pack — the other half is the syntax object in codegenJavascript.js.
 *
 * Sections:
 *   signatures  — Per-function type signatures + code generation rules
 *   functions   — Helper function definitions injected into output when needed
 *   templates   — Pattern-based code generation with <placeholder> tokens
 *
 * Signature code generation modes (in order of precedence):
 *   1. template      — Named template from the templates section. Placeholders:
 *                       <input1>, <input2>, ... for parent expressions,
 *                       <var> for variable name, <value> for node expression.
 *   2. operator      — Binary infix: code_before + child1 + operator + child2 + code_after
 *   3. wrap (default) — code_before + children joined with ", " + code_after
 *
 * Additional signature fields:
 *   add_functions      — Keys from the functions section to include in output
 *   is_helper_function — Marks custom (transpiled) spreadsheet functions;
 *                        call syntax is auto-generated, don't set code_before/after
 *
 * Type wildcards:
 *   ARRAY[*] matches any array type (ARRAY[Number], ARRAY[Text], etc.)
 */
export default {
  "signatures": {
    "NEGATE": [
      {
        "inputs": ["Number"],
        "outputs": ["Number"],
        "code_before": "-(",
        "code_after": ")"
      }
    ],
    "NOT": [
      {
        "inputs": ["Boolean"],
        "outputs": ["Boolean"],
        "code_before": "sc_not(",
        "code_after": ")",
        "add_functions": ["SC_NOT"]
      }
    ],
    "LEN": [
      {
        "inputs": ["ARRAY[*]"],
        "outputs": ["Number"],
        "code_before": "(",
        "code_after": ").length"
      }
    ],
    "SIN": [
      {
        "inputs": ["Number"],
        "outputs": ["Number"],
        "code_before": "Math.sin(",
        "code_after": ")"
      }
    ],
    "EXP": [
      {
        "inputs": ["Number"],
        "outputs": ["Number"],
        "code_before": "Math.exp(",
        "code_after": ")"
      }
    ],
    "LN": [
      {
        "inputs": ["Number"],
        "outputs": ["Number"],
        "code_before": "Math.log(",
        "code_after": ")"
      }
    ],
    "FLOOR": [
      {
        "inputs": ["Number"],
        "outputs": ["Number"],
        "code_before": "Math.floor(",
        "code_after": ")"
      }
    ],
    "MOD": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Number"],
        "operator": "%",
        "code_before": "(",
        "code_after": ")"
      }
    ],
    "SUM": [
      {
        "inputs": ["ARRAY[Number]"],
        "outputs": ["Number"],
        "code_after": ".reduce((a, b) => a + b, 0)"
      }
    ],
    "MIN": [
      {
        "inputs": ["ARRAY[Number]"],
        "outputs": ["Number"],
        "code_before": "Math.min(...",
        "code_after": ")"
      }
    ],
    "MAX": [
      {
        "inputs": ["ARRAY[Number]"],
        "outputs": ["Number"],
        "code_before": "Math.max(...",
        "code_after": ")"
      }
    ],
    "AND": [
      {
        "inputs": ["ARRAY[Boolean]"],
        "outputs": ["Boolean"],
        "code_before": "sc_and(",
        "code_after": ")",
        "add_functions": ["SC_AND"]
      }
    ],
    "OR": [
      {
        "inputs": ["ARRAY[Boolean]"],
        "outputs": ["Boolean"],
        "code_before": "sc_or(",
        "code_after": ")",
        "add_functions": ["SC_OR"]
      }
    ],
    "ADD": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Number"],
        "operator": "+",
        "code_before": "(",
        "code_after": ")"
      },
      {
        "inputs": ["Date", "Number"],
        "outputs": ["Date"],
        "operator": "+",
        "code_before": "Math.trunc(",
        "code_after": ")"
      },
      {
        "inputs": ["Number", "Date"],
        "outputs": ["Date"],
        "operator": "+",
        "code_before": "Math.trunc(",
        "code_after": ")"
      },
      {
        "inputs": ["Datetime", "Number"],
        "outputs": ["Datetime"],
        "operator": "+",
        "code_before": "(",
        "code_after": ")"
      },
      {
        "inputs": ["Number", "Datetime"],
        "outputs": ["Datetime"],
        "operator": "+",
        "code_before": "(",
        "code_after": ")"
      }
    ],
    "SUBTRACT": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Number"],
        "operator": "-",
        "code_before": "(",
        "code_after": ")"
      },
      {
        "inputs": ["Date", "Number"],
        "outputs": ["Date"],
        "operator": "-",
        "code_before": "Math.trunc(",
        "code_after": ")"
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Number"],
        "operator": "-",
        "code_before": "(",
        "code_after": ")"
      },
      {
        "inputs": ["Datetime", "Number"],
        "outputs": ["Datetime"],
        "operator": "-",
        "code_before": "(",
        "code_after": ")"
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Number"],
        "operator": "-",
        "code_before": "(",
        "code_after": ")"
      }
    ],
    "MULTIPLY": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Number"],
        "operator": "*",
        "code_before": "(",
        "code_after": ")"
      }
    ],
    "DIVIDE": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Number"],
        "operator": "/",
        "code_before": "(",
        "code_after": ")"
      }
    ],
    "EXPONENT": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Number"],
        "operator": "**",
        "code_before": "(",
        "code_after": ")"
      }
    ],
    "GREATER": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_gt(",
        "code_after": ")",
        "add_functions": ["SC_NUM_GT"]
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_gt(",
        "code_after": ")",
        "add_functions": ["SC_NUM_GT"]
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_gt(",
        "code_after": ")",
        "add_functions": ["SC_NUM_GT"]
      }
    ],
    "LESS": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_lt(",
        "code_after": ")",
        "add_functions": ["SC_NUM_LT"]
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_lt(",
        "code_after": ")",
        "add_functions": ["SC_NUM_LT"]
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_lt(",
        "code_after": ")",
        "add_functions": ["SC_NUM_LT"]
      }
    ],
    "GREATEREQUAL": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_gte(",
        "code_after": ")",
        "add_functions": ["SC_NUM_GTE"]
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_gte(",
        "code_after": ")",
        "add_functions": ["SC_NUM_GTE"]
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_gte(",
        "code_after": ")",
        "add_functions": ["SC_NUM_GTE"]
      }
    ],
    "LESSEQUAL": [
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_lte(",
        "code_after": ")",
        "add_functions": ["SC_NUM_LTE"]
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_lte(",
        "code_after": ")",
        "add_functions": ["SC_NUM_LTE"]
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_lte(",
        "code_after": ")",
        "add_functions": ["SC_NUM_LTE"]
      }
    ],
    "EQUAL": [
      {
        "inputs": ["Text", "Text"],
        "outputs": ["Boolean"],
        "code_before": "sc_eq(",
        "code_after": ")",
        "add_functions": ["SC_EQ"]
      },
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_eq(",
        "code_after": ")",
        "add_functions": ["SC_NUM_EQ"]
      },
      {
        "inputs": ["Boolean", "Boolean"],
        "outputs": ["Boolean"],
        "code_before": "sc_eq(",
        "code_after": ")",
        "add_functions": ["SC_EQ"]
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_eq(",
        "code_after": ")",
        "add_functions": ["SC_NUM_EQ"]
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_eq(",
        "code_after": ")",
        "add_functions": ["SC_NUM_EQ"]
      }
    ],
    "NOTEQUAL": [
      {
        "inputs": ["Text", "Text"],
        "outputs": ["Boolean"],
        "code_before": "sc_neq(",
        "code_after": ")",
        "add_functions": ["SC_NEQ"]
      },
      {
        "inputs": ["Number", "Number"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_neq(",
        "code_after": ")",
        "add_functions": ["SC_NUM_NEQ"]
      },
      {
        "inputs": ["Boolean", "Boolean"],
        "outputs": ["Boolean"],
        "code_before": "sc_neq(",
        "code_after": ")",
        "add_functions": ["SC_NEQ"]
      },
      {
        "inputs": ["Date", "Date"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_neq(",
        "code_after": ")",
        "add_functions": ["SC_NUM_NEQ"]
      },
      {
        "inputs": ["Datetime", "Datetime"],
        "outputs": ["Boolean"],
        "code_before": "sc_num_neq(",
        "code_after": ")",
        "add_functions": ["SC_NUM_NEQ"]
      }
    ],
    "IF": [
      {
        "inputs": ["Boolean", "Number", "Number"],
        "outputs": ["Number"],
        "code_before": "sc_if(",
        "code_after": ")",
        "add_functions": ["SC_IF"]
      },
      {
        "inputs": ["Boolean", "Text", "Text"],
        "outputs": ["Text"],
        "code_before": "sc_if(",
        "code_after": ")",
        "add_functions": ["SC_IF"]
      },
      {
        "inputs": ["Boolean", "Boolean", "Boolean"],
        "outputs": ["Boolean"],
        "code_before": "sc_if(",
        "code_after": ")",
        "add_functions": ["SC_IF"]
      },
      {
        "inputs": ["Boolean", "Date", "Date"],
        "outputs": ["Date"],
        "code_before": "sc_if(",
        "code_after": ")",
        "add_functions": ["SC_IF"]
      },
      {
        "inputs": ["Boolean", "Datetime", "Datetime"],
        "outputs": ["Datetime"],
        "code_before": "sc_if(",
        "code_after": ")",
        "add_functions": ["SC_IF"]
      }
    ]
  },
  "functions": {
    "SC_NUM_EQ": {
      "text": "function sc_num_eq(a, b) { return (!isFinite(a) || !isFinite(b)) ? NaN : (a === b); }"
    },
    "SC_NUM_NEQ": {
      "text": "function sc_num_neq(a, b) { return (!isFinite(a) || !isFinite(b)) ? NaN : (a !== b); }"
    },
    "SC_NUM_LT": {
      "text": "function sc_num_lt(a, b) { return (!isFinite(a) || !isFinite(b)) ? NaN : (a < b); }"
    },
    "SC_NUM_GT": {
      "text": "function sc_num_gt(a, b) { return (!isFinite(a) || !isFinite(b)) ? NaN : (a > b); }"
    },
    "SC_NUM_LTE": {
      "text": "function sc_num_lte(a, b) { return (!isFinite(a) || !isFinite(b)) ? NaN : (a <= b); }"
    },
    "SC_NUM_GTE": {
      "text": "function sc_num_gte(a, b) { return (!isFinite(a) || !isFinite(b)) ? NaN : (a >= b); }"
    },
    "SC_EQ": {
      "text": "function sc_eq(a, b) { return (a !== a || b !== b) ? NaN : (a === b); }"
    },
    "SC_NEQ": {
      "text": "function sc_neq(a, b) { return (a !== a || b !== b) ? NaN : (a !== b); }"
    },
    "SC_IF": {
      "text": "function sc_if(c, t, f) { return (c === true) ? t : (c === false) ? f : NaN; }"
    },
    "SC_AND": {
      "text": "function sc_and(arr) { let n = false; for (const v of arr) { if (v === false) return false; if (v !== true) n = true; } return n ? NaN : true; }"
    },
    "SC_OR": {
      "text": "function sc_or(arr) { let n = false; for (const v of arr) { if (v === true) return true; if (v !== false) n = true; } return n ? NaN : false; }"
    },
    "SC_NOT": {
      "text": "function sc_not(v) { return (typeof v === 'boolean') ? !v : NaN; }"
    }
  },
  "templates": {},
  // Custom function overrides: function name → hand-written code string.
  // When a custom spreadsheet function has an override, the override code
  // is emitted instead of transpiling the function's DAG.
  "customFunctionOverrides": {},
  // Used by updateConversionRules for merging; populated at runtime
  "transforms": {},
  "function_logic_dags": {}
};
