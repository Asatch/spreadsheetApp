/**
 * @file Canonical Values Engine
 * @description Owns canonical input storage and interpretation. Parsing happens
 * in interpretInput(), but results are passed to CalcEngine, not stored here.
 * CanonicalValuesEngine = "source code", CalcEngine = "runtime".
 */

import { TypeService } from '../utils/typeService.js';
import { DATE_INPUT_FORMAT } from '../utils/serialDate.js';
import { parseFormula as parseFormulaUtil } from '../utils/formulaParser.js';
import { tokenize, TokenType, recomputeTokenPositions, serializeTokens } from '../utils/formulaTokenizer.js';

const isEmpty = (val) => val === undefined || val === '';
import { isCellReference, parseCellKey } from '../utils/cellUtils.js';

/**
 * @typedef {Object} InterpretedInput
 * @property {string} canonical - Canonical form of the input (normalized)
 * @property {string} type - Type of input ('formula', 'Number', 'Text', 'Date', etc.)
 * @property {*} parsed - Parsed value (precedents array for formulas, native value for others)
 * @property {string[]} [anonymousExprs] - Anonymous expressions to queue (formulas only)
 */

/**
 * @typedef {Object} ParsedValueInfo
 * @property {string} type - Type of the value ('formula', 'Number', 'Text', 'Date', etc.)
 * @property {*} parsed - Parsed value (precedents array for formulas, native value for others)
 */

/**
 * @typedef {Object} InitConfig
 * @property {function(Map<string, ParsedValueInfo>): void} onValueChangeDpn - Callback when values change (notifies CalcEngine)
 * @property {string} dateInputFormatDpn - Date input format ('US' or 'EU')
 * @property {function(string): string} normalizeNameDpn - Function to normalize entity names
 * @property {function(string): boolean} isValidNameSyntaxDpn - Function to validate name syntax
 * @property {function(string): boolean} onCheckIfFunctionDpn - Function to check if name is a built-in function
 * @property {string[]} singleArrayFunctions - Built-in function names that take a single ARRAY argument
 * @property {function(string, string[]): void} recordChangesDpn - Function to record changes for history
 * @property {function(string, Map, function): void} onRegisterHistoryMapDpn - Function to register storage with history engine
 */

/**
 * @typedef {Object} NamedEntityResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if operation failed
 * @property {string} [name] - The entity name (if successful)
 */

/**
 * @typedef {Object} NamedRangeResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if operation failed
 * @property {string} [name] - The range name (if successful)
 * @property {string} [notation] - The range notation (if successful)
 */

/**
 * @typedef {Object} RenameResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if operation failed
 * @property {string} [oldName] - The old name (if successful)
 * @property {string} [newName] - The new name (if successful)
 */

/**
 * @typedef {Object} NamedRange
 * @property {string} name - The name of the range
 * @property {string} notation - The range notation (e.g., "A1:B2")
 */

/**
 * Creates the canonical values engine.
 *
 * Manages the storage and interpretation of all user input values. Acts as the "source code"
 * layer while CalcEngine handles the "runtime" layer. Maintains three key indexes:
 * - Named inputs (can exist without storage entry when empty)
 * - Named ranges (must have storage entry)
 * - Range-to-name reverse lookup (for O(1) lookups)
 *
 * @returns {{
 *   init: function(InitConfig): void,
 *   setValue: function(string, string): void,
 *   setBatch: function(Array<[string, string]>): void,
 *   getValue: function(string): string|undefined,
 *   createNamedInput: function(string): NamedEntityResult,
 *   renameNamedInput: function(string, string): RenameResult,
 *   deleteNamedInput: function(string): NamedEntityResult,
 *   createNamedRange: function(string, string): NamedRangeResult,
 *   deleteNamedRange: function(string): NamedEntityResult,
 *   renameNamedRange: function(string, string): RenameResult,
 *   moveNamedRange: function(string, string): NamedRangeResult,
 *   getAllNamedRanges: function(): NamedRange[],
 *   resolveNamedRange: function(string): string|null,
 *   lookupRangeName: function(string): string|null,
 *   getAllNamedInputs: function(): string[],
 *   reorderNamedInputs: function(string[]): void
 * }} Engine instance with public API methods
 */
/** Reserved storage key for ephemeral preview evaluations (see previewEvaluate). */
export const PREVIEW_KEY = '~PREVIEW';

/**
 * Pre-parse token normalization. Mutates `tokens` in place.
 *
 * Three passes: strip whitespace, balance unmatched delimiters, wrap
 * single-array-function call sites in braces. Finally, repacks token .start/.end
 * positions so they match the canonical form (downstream provenance and
 * findErrorSpans rely on these positions lining up with the stored string).
 *
 * Anonymous expressions skip this — their tokens come in already normalized
 * from the parent's parse. See the cascade in processQueueAndNotify.
 *
 * @param {Array} tokens
 * @param {Set<string>} singleArrayFunctions
 */
function normalizeTokens(tokens, singleArrayFunctions) {
  function insertTokenAt(insertIdx, type, value) {
    const prevDepth = insertIdx > 0 ? tokens[insertIdx - 1].depth : 0;
    // Synthetic openers go before existing content — fall back to the next
    // real token's raw start so downstream span mapping lands on real text.
    const nextTok = tokens[insertIdx];
    const rawFallback = nextTok ? nextTok.rawStart : 0;
    tokens.splice(insertIdx, 0, { type, start: 0, end: 0, value, depth: prevDepth, synthetic: true, rawStart: rawFallback, rawEnd: rawFallback });
  }

  function wrapInBraces(lparenIdx, rparenIdx) {
    const braceDepth = tokens[lparenIdx].depth + 1;
    const lparenRawEnd = tokens[lparenIdx].rawEnd;
    const rparenRawStart = tokens[rparenIdx].rawStart;

    for (let i = lparenIdx + 1; i < rparenIdx; i++) {
      tokens[i].depth += 1;
    }

    // Insert RBRACE before RPAREN (do first so lparenIdx stays valid).
    // Marked synthetic so the formula bar can exclude them when mapping
    // canonical positions back to the raw editing text (they don't exist
    // in the raw input). rawStart/rawEnd collapse to the adjacent paren's
    // raw position so error spans landing on a synthetic still highlight
    // something sensible.
    tokens.splice(rparenIdx, 0, { type: TokenType.RBRACE, start: 0, end: 0, value: '}', depth: braceDepth, synthetic: true, rawStart: rparenRawStart, rawEnd: rparenRawStart });
    tokens.splice(lparenIdx + 1, 0, { type: TokenType.LBRACE, start: 0, end: 0, value: '{', depth: braceDepth, synthetic: true, rawStart: lparenRawEnd, rawEnd: lparenRawEnd });
  }

  // Strip WHITESPACE (reverse order to keep indices valid)
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].type === TokenType.WHITESPACE) tokens.splice(i, 1);
  }

  // Balance unmatched delimiters
  {
    let parenDepth = 0, braceDepth = 0;
    let extraClosingParens = 0, extraClosingBraces = 0;
    for (const tok of tokens) {
      if (tok.type === TokenType.LPAREN) parenDepth++;
      else if (tok.type === TokenType.RPAREN) {
        if (parenDepth > 0) parenDepth--;
        else extraClosingParens++;
      }
      else if (tok.type === TokenType.LBRACE) braceDepth++;
      else if (tok.type === TokenType.RBRACE) {
        if (braceDepth > 0) braceDepth--;
        else extraClosingBraces++;
      }
    }
    // Append missing closers at end (depths count down from trailing running depth)
    if (parenDepth > 0 || braceDepth > 0) {
      const lastTok = tokens[tokens.length - 1];
      let runningDepth = lastTok.depth;
      if (lastTok.type === TokenType.LPAREN || lastTok.type === TokenType.LBRACE) {
        runningDepth = lastTok.depth + 1;
      }
      // All trailing synthetics collapse to the raw end of the last real token.
      const rawFallback = lastTok.rawEnd;
      for (let n = 0; n < parenDepth; n++) {
        runningDepth--;
        tokens.push({ type: TokenType.RPAREN, start: 0, end: 0, value: ')', depth: runningDepth, synthetic: true, rawStart: rawFallback, rawEnd: rawFallback });
      }
      for (let n = 0; n < braceDepth; n++) {
        runningDepth--;
        tokens.push({ type: TokenType.RBRACE, start: 0, end: 0, value: '}', depth: runningDepth, synthetic: true, rawStart: rawFallback, rawEnd: rawFallback });
      }
    }

    // Insert missing openers after EQUALS (index 1), depths nest 0..N-1
    if (extraClosingParens > 0 || extraClosingBraces > 0) {
      const totalInserted = extraClosingParens + extraClosingBraces;

      for (let n = 0; n < extraClosingParens; n++) insertTokenAt(1, TokenType.LPAREN, '(');
      for (let n = 0; n < extraClosingBraces; n++) insertTokenAt(1, TokenType.LBRACE, '{');

      // Fix opener depths: outermost (index 1) = d0, innermost (index N) = d(N-1)
      for (let i = 1; i <= totalInserted; i++) {
        tokens[i].depth = i - 1;
      }
      for (let i = 1 + totalInserted; i < tokens.length; i++) {
        tokens[i].depth += totalInserted;
      }
    }
  }

  // Wrap single-array functions at ALL depths.
  // Scan right-to-left so insertions don't affect earlier positions.
  for (let ti = tokens.length - 1; ti >= 0; ti--) {
    if (tokens[ti].type !== TokenType.IDENT) continue;
    if (!singleArrayFunctions.has(tokens[ti].value)) continue;
    if (ti + 1 >= tokens.length || tokens[ti + 1].type !== TokenType.LPAREN) continue;

    const parenOpenIdx = ti + 1;
    const parenDepth = tokens[parenOpenIdx].depth;
    let parenCloseIdx = -1;
    for (let tj = parenOpenIdx + 1; tj < tokens.length; tj++) {
      if (tokens[tj].type === TokenType.RPAREN && tokens[tj].depth === parenDepth) {
        parenCloseIdx = tj;
        break;
      }
    }
    if (parenCloseIdx < 0) continue;

    if (tokens[parenOpenIdx + 1]?.type === TokenType.LBRACE) continue;

    const innerDepth = parenDepth + 1;
    let argCount = 1;
    for (let tj = parenOpenIdx + 1; tj < parenCloseIdx; tj++) {
      if (tokens[tj].type === TokenType.COMMA && tokens[tj].depth === innerDepth) argCount++;
    }
    if (argCount <= 1) continue;

    wrapInBraces(parenOpenIdx, parenCloseIdx);
  }

  // Mutations above invalidate the original source positions; repack so
  // .start/.end are consistent with the canonical form.
  recomputeTokenPositions(tokens);
}

export function createCanonicalValuesEngine() {
  /**
   * Storage: canonical strings only (Map<string, string>)
   * Note: Empty values are GC'd from storage. Named inputs can exist in index without storage entry.
   * @type {Map<string, string>}
   */
  const storage = new Map();

  /**
   * Processing queue: key → {rawValue, tokens?} (Map provides automatic deduping)
   * tokens is optional — present when caller provides pre-tokenized input.
   * @type {Map<string, {rawValue: string, tokens?: Array}>}
   */
  const processingQueue = new Map();

  /**
   * Named-input index. Genuinely non-derivable: empty named inputs have no
   * storage entry, so membership must be tracked separately. Named ranges, by
   * contrast, always have a storage entry (the =notation value) and are
   * derived as `isNamedEntity(key) && !namedInputs.has(key) && storage.get(key)?.startsWith('=')`.
   * @type {Set<string>}
   */
  const namedInputs = new Set();

  /**
   * Notation → name reverse index for named ranges. Updated as a side effect
   * of storage writes in processQueueAndNotify, so batched writes (e.g.
   * clipboardEngine cut/paste) see a consistent index after the drain.
   * @type {Map<string, string>}
   */
  const rangeToName = new Map();

  /**
   * Expression provenance: cellKey → { expressionMap, tokens }
   * Stores the parser's provenance output for each formula cell.
   * expressionMap: { anonKey: [{ startToken, endToken, startChar, endChar }, ...] }
   * tokens: Token[] from the tokenizer
   * GC'd when cell is deleted or overwritten with a non-formula value.
   * @type {Map<string, {expressionMap: Object, tokens: Array}>}
   */
  const expressionProvenance = new Map();

  /**
   * Functions that take a single ARRAY[Type] argument (e.g., SUM, MIN, MAX).
   * Populated at init from built-in function registry; updated when custom functions
   * are registered/unregistered.
   * @type {Set<string>}
   */
  const singleArrayFunctions = new Set();

  /**
   * Callbacks (injected via init)
   * @type {function(Map<string, ParsedValueInfo>): void|null}
   */
  let onValueChange = null;

  /** @type {function(string): string|null} */
  let normalizeName = null;

  /** @type {function(string): boolean|null} */
  let isValidNameSyntax = null;

  /** @type {function(string): boolean|null} */
  let onCheckIfFunction = null;

  /** @type {function(string, string[]): void|null} */
  let recordChanges = null;

  /** @type {function(string, Map, function): void|null} */
  let onRegisterHistoryMap = null;

  /**
   * Date input format preference (US: MM/DD/YYYY, EU: DD/MM/YYYY)
   * @type {string}
   */
  let dateInputFormat = DATE_INPUT_FORMAT.US;

  function isAnonymous(key) {
    return key.startsWith('=');
  }

  function isNamedEntity(key) {
    return !isCellReference(key) && !isAnonymous(key);
  }

  function isNamedRange(name) {
    if (namedInputs.has(name)) return false;
    if (!isNamedEntity(name)) return false;
    const canonical = storage.get(name);
    return canonical != null && canonical.startsWith('=');
  }

  /**
   * Interprets raw input value and determines type/parsed form.
   *
   * Handles formulas (parses precedents), numbers, text, and dates. For formulas,
   * passes singleArrayFunctions to the parser for ARRAY wrapping.
   *
   * For values, delegates to TypeService.
   *
   * @param {string} rawValue - The raw input value to interpret
   * @returns {InterpretedInput} Interpreted result with canonical form, type, parsed value, and optional anonymous expressions
   */
  function interpretInput(rawValue, preTokenized, skipNormalization) {
    // Formulas bypass TypeService (which handles VALUE types only).
    if (rawValue && rawValue.startsWith('=')) {
      const tokens = preTokenized || tokenize(rawValue);

      if (!skipNormalization) normalizeTokens(tokens, singleArrayFunctions);

      // serializeTokens re-adds $ markers from CELL_REF colAbs/rowAbs flags
      // so absolute refs round-trip.
      const canonical = serializeTokens(tokens);

      const { precedents, anonymousExpressions, expressionMap: parsedExprMap, errorSpan } =
        parseFormulaUtil(tokens);

      return {
        canonical,
        type: 'formula',
        parsed: precedents,
        anonymousExprs: anonymousExpressions,
        expressionMap: parsedExprMap,
        errorSpan,
        tokens
      };
    }

    const result = TypeService.detectType(rawValue, dateInputFormat);

    return {
      canonical: result.canonicalValue,
      type: result.type,
      parsed: result.value
    };
  }

  /**
   * Flag to skip history recording (used by loop sheets for generated rows)
   * @type {boolean}
   */
  let skipHistoryRecording = false;

  /**
   * Drains the queue (cascading into anonymous expressions) and sends one batch
   * notification to CalcEngine. History is recorded once, up front.
   */
  function processQueueAndNotify() {
    // Record history before mutations, capturing only the initial queue —
    // anonymous expressions added during processing are derived and will be GC'd.
    if (processingQueue.size > 0 && !skipHistoryRecording) {
      const keysToChange = Array.from(processingQueue.keys());
      recordChanges('canonicalValues', keysToChange);
    }

    /** @type {Map<string, ParsedValueInfo>} key → {type, parsed} */
    const changedInfo = new Map();

    while (processingQueue.size > 0) {
      const [key, queueEntry] = processingQueue.entries().next().value;
      processingQueue.delete(key);

      const { rawValue, tokens: preTokenized, skipNormalization } = queueEntry;
      /** @type {InterpretedInput} */
      const entry = interpretInput(rawValue, preTokenized, skipNormalization);

      // Capture prior range-notation (if any) before mutating storage, so we
      // can update rangeToName as a side effect of the write below. Named
      // inputs are excluded even if their value starts with '='.
      const maintainsRangeIndex = isNamedEntity(key) && !namedInputs.has(key);
      const oldCanonical = maintainsRangeIndex ? storage.get(key) : undefined;
      const oldNotation = oldCanonical && oldCanonical.startsWith('=') ? oldCanonical.substring(1) : null;

      // Empty value: drop from storage, but still notify CalcEngine so dependents clear.
      // GC policy: named inputs can live in the index without a storage entry;
      // named ranges cannot (they need the =notation value to exist).
      if (entry.type === 'Text' && entry.parsed === '') {
        if (storage.has(key)) {
          storage.delete(key);
        }
        expressionProvenance.delete(key);
        if (oldNotation) rangeToName.delete(oldNotation);
        changedInfo.set(key, { type: 'Text', parsed: '' });
        continue;
      }

      storage.set(key, entry.canonical);

      if (maintainsRangeIndex) {
        const newNotation = entry.canonical.startsWith('=') ? entry.canonical.substring(1) : null;
        if (oldNotation && oldNotation !== newNotation) rangeToName.delete(oldNotation);
        if (newNotation) rangeToName.set(newNotation, key);
      }

      if (entry.tokens) {
        expressionProvenance.set(key, {
          expressionMap: entry.expressionMap || {},
          errorSpan: entry.errorSpan,
          tokens: entry.tokens
        });
      } else {
        expressionProvenance.delete(key);
      }

      changedInfo.set(key, {
        type: entry.type,
        parsed: entry.parsed
      });

      // Re-queue anonymous expressions unconditionally: CalcEngine GCs them
      // when their last dependent goes away, so the edit that got us here may
      // have dropped them. Token slices from the parent's parse avoid re-tokenization.
      if (entry.anonymousExprs) {
        entry.anonymousExprs.forEach(expr => {
          let exprTokens = null;
          if (entry.expressionMap && entry.expressionMap[expr]) {
            const origins = entry.expressionMap[expr];
            // Prepend synthetic EQUALS so the slice is treated as a formula.
            // Skip normalization — these tokens are already normalized slices
            // with parent-relative positions. Synthetic EQUALS inherits the
            // first sliced token's raw position so error spans hitting it
            // still land on real user text.
            const firstSliced = entry.tokens[origins[0].startToken];
            const rawFallback = firstSliced ? firstSliced.rawStart : 0;
            exprTokens = [
              { type: TokenType.EQUALS, start: 0, end: 0, value: '=', depth: 0, rawStart: rawFallback, rawEnd: rawFallback },
              ...entry.tokens.slice(origins[0].startToken, origins[0].endToken)
            ];
          }
          processingQueue.set(expr, { rawValue: expr, tokens: exprTokens, skipNormalization: true });
        });
      }
    }

    if (changedInfo.size > 0) {
      onValueChange(changedInfo);
    }
  }

  // Shared implementation for setValue / setClassified.
  // No-ops when the stored value is unchanged (undefined and '' are equivalent).
  function _setWithTokens(key, rawValue, tokens) {
    const currentValue = storage.get(key);
    if (isEmpty(currentValue) && isEmpty(rawValue)) return;
    if (currentValue === rawValue) return;

    processingQueue.set(key, { rawValue, tokens });
    processQueueAndNotify();
  }

  function setValue(key, rawValue) {
    const tokens = (rawValue && rawValue.startsWith('=')) ? tokenize(rawValue) : null;
    _setWithTokens(key, rawValue, tokens);
  }

  /**
   * Accepts heterogeneous entries:
   *   - `[key, value]` — plain string; tokenized if it's a formula.
   *   - `[key, null, tokens]` — pre-tokenized formula (skips a re-tokenize).
   * Drains the queue once, so mixed batches yield one history checkpoint
   * and one CalcEngine notification.
   *
   * @param {Array<[string, string|null, import('../utils/formulaTokenizer.js').Token[]?]>} entries
   * @param {Object} [options]
   * @param {boolean} [options.skipHistory=false]
   */
  function setBatch(entries, options = {}) {
    let hasChanges = false;
    for (const entry of entries) {
      const key = entry[0];
      const value = entry[1];
      const preTokens = entry[2];

      let rawValue, queueTokens;
      if (preTokens) {
        queueTokens = preTokens.map(t => ({ ...t }));
        rawValue = serializeTokens(queueTokens);
      } else {
        rawValue = value;
        queueTokens = (rawValue && rawValue.startsWith('=')) ? tokenize(rawValue) : null;
      }

      const currentValue = storage.get(key);
      if (isEmpty(currentValue) && isEmpty(rawValue)) continue;
      if (currentValue === rawValue) continue;

      processingQueue.set(key, { rawValue, tokens: queueTokens });
      hasChanges = true;
    }

    if (hasChanges) {
      if (options.skipHistory) skipHistoryRecording = true;
      try {
        processQueueAndNotify();
      } finally {
        skipHistoryRecording = false;
      }
    }
  }

  return {
    /** @param {InitConfig} deps */
    init(deps) {
      const required = [
        'onValueChange', 'dateInputFormat', 'normalizeName', 'isValidNameSyntax',
        'onCheckIfFunction', 'recordChanges', 'onRegisterHistoryMap'
      ];
      for (const key of required) {
        if (deps[key] == null) {
          throw new Error(`[CanonicalValuesEngine] init missing required dependency: ${key}`);
        }
      }
      if (typeof deps.onRegisterHistoryMap.registerSnapshotProvider !== 'function') {
        throw new Error('[CanonicalValuesEngine] init: onRegisterHistoryMap must expose registerSnapshotProvider');
      }

      ({
        onValueChange,
        dateInputFormat,
        normalizeName,
        isValidNameSyntax,
        onCheckIfFunction,
        recordChanges,
        onRegisterHistoryMap
      } = deps);

      // Initialize single-array functions set from built-in function registry
      if (deps.singleArrayFunctions) {
        for (const name of deps.singleArrayFunctions) {
          singleArrayFunctions.add(name);
        }
      }

      onRegisterHistoryMap('canonicalValues', storage, (delta) => {
        // Undo/redo rebuild: HistoryEngine hands us prior values; undefined means delete.
        const entries = Array.from(delta.entries()).map(([key, value]) => [key, value ?? '']);
        setBatch(entries);
      });

      // namedInputs needs its own snapshot — rangeToName is derived from storage below.
      onRegisterHistoryMap.registerSnapshotProvider(
        'namedInputs',
        () => new Set(namedInputs),
        (snapshot) => {
          namedInputs.clear();
          for (const name of snapshot) namedInputs.add(name);

          rangeToName.clear();
          for (const [key, canonical] of storage.entries()) {
            if (isNamedEntity(key) && !namedInputs.has(key) && canonical && canonical.startsWith('=')) {
              rangeToName.set(canonical.substring(1), key);
            }
          }
        }
      );
    },

    setValue,
    setBatch,

    // Formula-bar entry point: tokens come in pre-tokenized (raw output, may
    // include WHITESPACE). Normalization happens inside interpretInput.
    setClassified(key, tokens) {
      // Clone: the caller retains a reference to the original array;
      // interpretInput mutates tokens in-place.
      const cloned = tokens.map(t => ({ ...t }));
      const rawValue = serializeTokens(cloned);
      _setWithTokens(key, rawValue, cloned);
    },

    getValue(key) {
      return storage.get(key);
    },

    /**
     * Case-insensitive substring search over canonical values of cell-reference
     * keys. Skips PREVIEW, anonymous expressions, and named entities.
     * Results are sorted in grid order (row asc, then column asc).
     *
     * @param {string} query
     * @returns {Array<{key: string, canonical: string}>}
     */
    findMatches(query) {
      if (!query) return [];
      const needle = query.toLowerCase();
      const results = [];
      for (const [key, canonical] of storage.entries()) {
        if (key === PREVIEW_KEY) continue;
        if (isAnonymous(key)) continue;
        if (!isCellReference(key)) continue;
        if (canonical.toLowerCase().includes(needle)) {
          results.push({ key, canonical });
        }
      }
      results.sort((a, b) => {
        const pa = parseCellKey(a.key);
        const pb = parseCellKey(b.key);
        if (pa.row !== pb.row) return pa.row - pb.row;
        return pa.colNum - pb.colNum;
      });
      return results;
    },

    getExpressionProvenance(key) {
      return expressionProvenance.get(key);
    },

    /**
     * Walk the expression tree to find the deepest sub-expressions responsible
     * for errors in a cell. Returns spans in coordinates matching what the
     * formula bar displays for that cell:
     *   - PREVIEW_KEY: raw coords (user's in-progress edit buffer) via
     *     rawStart/rawEnd, which were stamped at tokenize time before
     *     normalization shifted .start/.end.
     *   - Committed cells: canonical coords via .start/.end, matching the
     *     normalized string stored and displayed after reload.
     *
     * @param {string} cellKey
     * @param {function(string): Object|undefined} getNode - CalcEngine node lookup
     * @returns {Array<{startChar: number, endChar: number}>}
     */
    findErrorSpans(cellKey, getNode) {
      const node = getNode(cellKey);
      if (!node || !node.errorMeta?.length) return [];

      const prov = expressionProvenance.get(cellKey);
      if (!prov) return [];

      const useRaw = cellKey === PREVIEW_KEY;
      const getStart = useRaw ? (t => t.rawStart) : (t => t.start);
      const getEnd = useRaw ? (t => t.rawEnd) : (t => t.end);

      if (prov.errorSpan) {
        return [{
          startChar: getStart(prov.tokens[prov.errorSpan.startToken]),
          endChar: getEnd(prov.tokens[prov.errorSpan.endToken - 1])
        }];
      }

      const spans = [];

      function walk(exprMap, tokens) {
        // Track token indices covered by an anon origin so the leaf-check pass
        // below doesn't double-count — the recursive walk handles those ranges.
        const covered = new Set();

        for (const [key, origins] of Object.entries(exprMap)) {
          if (!key.startsWith('=')) continue;

          for (const origin of origins) {
            for (let i = origin.startToken; i < origin.endToken; i++) covered.add(i);
          }

          const childNode = getNode(key);
          if (!childNode || !childNode.errorMeta?.length) continue;

          const childProv = expressionProvenance.get(key);

          for (const origin of origins) {
            // Child provenance indices align with [synthetic=, ...parent.slice],
            // so building childTokens from the parent slice lets us resolve
            // child-relative indices to parent-coord positions (raw or canonical
            // depending on useRaw).
            const firstSliced = tokens[origin.startToken];
            const fallbackStart = firstSliced ? getStart(firstSliced) : 0;
            const childTokens = [
              { type: TokenType.EQUALS, start: fallbackStart, end: fallbackStart, value: '=', depth: 0, rawStart: fallbackStart, rawEnd: fallbackStart },
              ...tokens.slice(origin.startToken, origin.endToken)
            ];

            if (childProv?.errorSpan) {
              spans.push({
                startChar: getStart(childTokens[childProv.errorSpan.startToken]),
                endChar: getEnd(childTokens[childProv.errorSpan.endToken - 1])
              });
              continue;
            }

            const before = spans.length;
            walk(childProv?.expressionMap || {}, childTokens);

            // If nothing deeper was found, this is the most specific level
            if (spans.length === before) {
              spans.push({
                startChar: getStart(tokens[origin.startToken]),
                endChar: getEnd(tokens[origin.endToken - 1])
              });
            }
          }
        }

        // Leaf-check: tokens at this level that aren't covered by an anon and
        // resolve to an error source (missing ref, unknown name/function, or a
        // ref whose own node carries errorMeta) get their own span. The anon
        // walk above can't find these because the parser doesn't extract leaf
        // refs into expressionMap.
        for (let i = 0; i < tokens.length; i++) {
          if (covered.has(i)) continue;
          const t = tokens[i];
          if (t.type !== TokenType.CELL_REF && t.type !== TokenType.IDENT) continue;

          const refNode = getNode(t.value);
          if (!refNode || refNode.errorMeta?.length) {
            spans.push({ startChar: getStart(t), endChar: getEnd(t) });
          }
        }
      }

      walk(prov.expressionMap, prov.tokens);

      // If the cell has an error but we couldn't narrow to any sub-expression,
      // the error is at the top level (e.g., single-expression formula like =1/0)
      if (spans.length === 0) {
        const eqToken = prov.tokens[0]?.type === TokenType.EQUALS ? 1 : 0;
        if (prov.tokens.length > eqToken) {
          spans.push({
            startChar: getStart(prov.tokens[eqToken]),
            endChar: getEnd(prov.tokens[prov.tokens.length - 1])
          });
        }
      }

      return spans;
    },

    // GC callback from CalcEngine. Doesn't notify back — that would be circular,
    // since CalcEngine already cleared its own state before calling us.
    deleteAnonymousExpression(key) {
      if (!isAnonymous(key)) {
        console.warn('[CanonicalValuesEngine] deleteAnonymousExpression called with non-anonymous key:', key);
        return;
      }
      storage.delete(key);
      expressionProvenance.delete(key);
    },

    createNamedInput(name) {
      const normalized = normalizeName(name);

      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }
      if (namedInputs.has(normalized) || storage.has(normalized)) {
        return { success: false, error: 'Name already exists' };
      }
      if (onCheckIfFunction(normalized)) {
        return { success: false, error: 'Cannot overwrite built-in function' };
      }

      namedInputs.add(normalized);

      // Empty value: GC'd from storage, but name stays in the index.
      processingQueue.set(normalized, { rawValue: '' });
      processQueueAndNotify();

      return { success: true, name: normalized };
    },

    renameNamedInput(oldName, newName) {
      const normalized = normalizeName(newName);

      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }
      if (normalized !== oldName && (namedInputs.has(normalized) || storage.has(normalized))) {
        return { success: false, error: 'Name already exists' };
      }
      if (!namedInputs.has(oldName)) {
        return { success: false, error: 'Source name does not exist' };
      }

      const value = storage.get(oldName);

      namedInputs.delete(oldName);
      namedInputs.add(normalized);

      setBatch([
        [oldName, ''],
        [normalized, value || '']
      ]);

      return { success: true, oldName, newName: normalized };
    },

    deleteNamedInput(name) {
      if (!namedInputs.has(name)) {
        return { success: false, error: 'Name does not exist' };
      }

      namedInputs.delete(name);
      setValue(name, '');

      return { success: true, name };
    },

    createNamedRange(name, notation) {
      const normalized = normalizeName(name);
      const upperNotation = notation.toUpperCase();

      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }
      if (namedInputs.has(normalized) || storage.has(normalized)) {
        return { success: false, error: 'Name already exists' };
      }
      if (onCheckIfFunction(normalized)) {
        return { success: false, error: 'Cannot overwrite built-in function' };
      }

      setValue(normalized, `=${upperNotation}`);

      return { success: true, name: normalized, notation: upperNotation };
    },

    deleteNamedRange(name) {
      if (!isNamedRange(name)) {
        return { success: false, error: 'Name does not exist' };
      }
      setValue(name, '');
      return { success: true, name };
    },

    renameNamedRange(oldName, newName) {
      const normalized = normalizeName(newName);

      if (!isValidNameSyntax(normalized)) {
        return { success: false, error: 'Invalid name syntax' };
      }
      if (normalized !== oldName && (namedInputs.has(normalized) || storage.has(normalized))) {
        return { success: false, error: 'Name already exists' };
      }
      if (!isNamedRange(oldName)) {
        return { success: false, error: 'Source name does not exist' };
      }

      const canonical = storage.get(oldName);

      setBatch([
        [oldName, ''],
        [normalized, canonical || '']
      ]);

      return { success: true, oldName, newName: normalized };
    },

    // Returns the batch entry instead of applying it so callers can bundle
    // named-range moves atomically with other cut/paste updates in a single
    // setBatch. rangeToName updates when the caller commits through setBatch.
    moveNamedRange(name, newNotation) {
      if (!isNamedRange(name)) {
        return { success: false, error: 'Named range does not exist' };
      }
      const upperNotation = newNotation.toUpperCase();
      return {
        success: true,
        entry: [name, `=${upperNotation}`],
        name,
        notation: upperNotation
      };
    },

    getAllNamedRanges() {
      return Array.from(rangeToName.entries()).map(([notation, name]) => ({ name, notation }));
    },

    resolveNamedRange(name) {
      if (!isNamedRange(name)) return null;
      return storage.get(name).substring(1);
    },

    lookupRangeName(notation) {
      return rangeToName.get(notation.toUpperCase()) || null;
    },

    getAllNamedInputs() {
      return Array.from(namedInputs);
    },

    reorderNamedInputs(orderedArray) {
      // Validate against the current index, not storage — named inputs can
      // legitimately exist in the index with no storage entry (empty value).
      const currentInputs = new Set(namedInputs);
      namedInputs.clear();

      for (const name of orderedArray) {
        if (currentInputs.has(name)) {
          namedInputs.add(name);
        }
      }
    },

    updateSingleArrayFunctions(name, isArrayFn) {
      if (isArrayFn) {
        singleArrayFunctions.add(name);
      } else {
        singleArrayFunctions.delete(name);
      }
    },

    // Re-runs interpretInput on stored canonical strings so the current
    // singleArrayFunctions set is applied during normalization. Called when a
    // custom function's array signature changes (loaded/unloaded).
    renormalizeFormulas(cellKeys) {
      for (const key of cellKeys) {
        const canonical = storage.get(key);
        if (canonical && canonical.startsWith('=')) {
          processingQueue.set(key, { rawValue: canonical, tokens: tokenize(canonical) });
        }
      }
      if (processingQueue.size > 0) {
        processQueueAndNotify();
      }
    },

    setDateInputFormat(newFormat) {
      if (newFormat === DATE_INPUT_FORMAT.US || newFormat === DATE_INPUT_FORMAT.EU) {
        dateInputFormat = newFormat;
      }
    },

    getSnapshot() {
      // Exclude anonymous sub-expressions: they're derivable from their parent
      // formulas on restore via the cascade in processQueueAndNotify, and
      // re-seeding them would skip the parent's token-slice provenance path.
      // Named ranges aren't emitted either — they live in storage as =notation
      // entries and get rebuilt into rangeToName when the queue drains.
      return {
        canonicalValues: Array.from(storage.entries())
          .filter(([key]) => key !== PREVIEW_KEY && !isAnonymous(key)),
        namedInputs: Array.from(namedInputs)
      };
    },

    restoreSnapshot(data) {
      // Capture keys that exist before clearing so we can notify about removals
      const previousKeys = new Set(storage.keys());

      // Clear all state; the queue drain rebuilds everything through the
      // live-edit path.
      storage.clear();
      expressionProvenance.clear();
      namedInputs.clear();
      rangeToName.clear();

      // namedInputs must be restored BEFORE the queue drains, so the drain's
      // "is this a named range?" check (which excludes named inputs) is correct.
      for (const name of data.namedInputs || []) {
        namedInputs.add(name);
      }

      // Seed queue with top-level entries; the loop cascades into anonymous
      // expressions with the correct token-slice provenance.
      for (const [key, canonical] of data.canonicalValues || []) {
        processingQueue.set(key, { rawValue: canonical });
      }
      // Mark removed keys for deletion so CalcEngine clears stale state
      for (const key of previousKeys) {
        if (!processingQueue.has(key)) {
          processingQueue.set(key, { rawValue: '' });
        }
      }

      skipHistoryRecording = true;
      try {
        processQueueAndNotify();
      } finally {
        skipHistoryRecording = false;
      }
    },

    // Used by loop sheets to clear generated rows before regeneration.
    // Skips the calc cascade — caller is responsible for regenerating.
    silentDeleteKeys(keys) {
      for (const key of keys) {
        storage.delete(key);
        expressionProvenance.delete(key);
      }
    },

    // Ephemerally evaluates a formula through the normal parse → CalcEngine path
    // under the reserved ~PREVIEW key (unreferenceable). Result is read via getNode.
    previewEvaluate(rawValue, tokens = null) {
      const currentValue = storage.get(PREVIEW_KEY);
      if (isEmpty(currentValue) && isEmpty(rawValue)) return;
      if (currentValue === rawValue) return;

      // Clone caller-supplied tokens: normalizeTokens mutates in place (strips
      // whitespace, repacks positions), and the formula bar keeps the same
      // array for its highlight/caret logic, which needs raw positions intact.
      const resolvedTokens = tokens
        ? tokens.map(t => ({ ...t }))
        : ((rawValue && rawValue.startsWith('=')) ? tokenize(rawValue) : null);
      processingQueue.set(PREVIEW_KEY, { rawValue, tokens: resolvedTokens });
      skipHistoryRecording = true;
      try {
        processQueueAndNotify();
      } finally {
        skipHistoryRecording = false;
      }
    },

    // Deletes ~PREVIEW, which triggers CalcEngine GC for any anonymous
    // expressions that were created solely for the preview.
    previewClear() {
      setBatch([[PREVIEW_KEY, '']], { skipHistory: true });
    }
  };
}
