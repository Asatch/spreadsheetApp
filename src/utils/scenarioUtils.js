/**
 * Pure utility functions for scenario analysis.
 */

import { formatNumber } from './numberFormatter.js';

/**
 * Generate the cross product of input configurations.
 * @param {Array<{name: string, values: Array}>} inputConfigs
 * @returns {Array<Object>} Array of {inputName: value} combination objects
 */
export function crossProduct(inputConfigs) {
  if (inputConfigs.length === 0) return [{}];
  const [first, ...rest] = inputConfigs;
  const restCombos = crossProduct(rest);
  const results = [];
  for (const val of first.values) {
    for (const combo of restCombos) {
      results.push({ [first.name]: val, ...combo });
    }
  }
  return results;
}

/**
 * Randomly sample from the cross product without materializing all combinations.
 * Uses index-based decoding: each combination maps to a unique flat index,
 * decoded positionally (last input varies fastest).
 * @param {Array<{name: string, values: Array}>} inputConfigs
 * @param {number} sampleSize - Number of combinations to sample
 * @returns {Array<Object>} Array of {inputName: value} combination objects
 */
export function sampleCrossProduct(inputConfigs, sampleSize) {
  if (inputConfigs.length === 0) return [{}];

  const totalCombinations = inputConfigs.reduce((acc, c) => acc * c.values.length, 1);
  if (sampleSize >= totalCombinations) return crossProduct(inputConfigs);

  // Pick unique random indices
  const picked = new Set();
  while (picked.size < sampleSize) {
    picked.add(Math.floor(Math.random() * totalCombinations));
  }

  // Decode each index into a combination
  const results = [];
  for (const idx of picked) {
    const combo = {};
    let remainder = idx;
    for (let i = inputConfigs.length - 1; i >= 0; i--) {
      const config = inputConfigs[i];
      combo[config.name] = config.values[remainder % config.values.length];
      remainder = Math.floor(remainder / config.values.length);
    }
    results.push(combo);
  }
  return results;
}

/**
 * Find which varying input has the most influence on an output (OAT method).
 * Varies one input at a time while holding all others at their baseline values.
 * @param {Array} runs - Array of {inputs, outputs} result objects
 * @param {string} outputName - Which output to analyze
 * @param {Array<string>} varyingInputs - Names of non-fixed inputs with >1 value
 * @param {Object} inputConfigs - Map of inputName → {category, values, baseline}
 * @returns {string|null} Name of the top driver input, or null
 */
export function findTopDriver(runs, outputName, varyingInputs, inputConfigs) {
  if (varyingInputs.length === 0) return null;

  let topDriver = null;
  let topRange = 0;

  for (const inputName of varyingInputs) {
    const values = inputConfigs[inputName].values;

    // Filter runs where all OTHER varying inputs are at their baseline
    const otherVarying = varyingInputs.filter(n => n !== inputName);
    const baselineRuns = runs.filter(r =>
      otherVarying.every(n => String(r.inputs[n]) === String(inputConfigs[n].baseline))
    );

    if (baselineRuns.length === 0) continue;

    // Get the output value for each value of this input (at baseline of others)
    const outputs = values.map(val => {
      const run = baselineRuns.find(r => String(r.inputs[inputName]) === String(val));
      return run ? run.outputs[outputName] : undefined;
    }).filter(v => typeof v === 'number' && !isNaN(v));
    if (outputs.length < 2) continue;

    const min = outputs.reduce((m, v) => v < m ? v : m, Infinity);
    const max = outputs.reduce((m, v) => v > m ? v : m, -Infinity);
    const range = max - min;

    if (range > topRange) {
      topRange = range;
      topDriver = inputName;
    }
  }

  return topDriver;
}

/**
 * Format a value for display.
 * @param {*} val
 * @returns {string}
 */
export function formatNum(val) {
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString();
    if (Math.abs(val) >= 1) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return val.toPrecision(4);
  }
  return String(val);
}

/**
 * Parse a raw input string into a number (stripping commas/whitespace) or keep as string.
 * @param {string} raw
 * @returns {number|string}
 */
export function parseInputValue(raw) {
  const cleaned = raw.replace(/,/g, '').replace(/(\d)\s+(?=\d)/g, '$1').trim();
  const num = Number(cleaned);
  return isNaN(num) || cleaned === '' ? raw : num;
}

/**
 * Format an output value using a format spec from the output signature.
 * Returns a plain string (no HTML escaping).
 * @param {*} val - The value to format
 * @param {string} outputName - The output's name (for looking up its format spec)
 * @param {Array|null} outputSig - The function's output signature array
 * @returns {string}
 */
export function formatOutputVal(val, outputName, outputSig) {
  if (typeof val !== 'number' || isNaN(val)) return String(val);
  const outputEntry = outputSig?.find(o => o.name === outputName);
  if (outputEntry?.format) return formatNumber(val, outputEntry.format);
  return formatNumber(val, { subCategory: 'number', useAdaptiveDecimals: false, decimalPlaces: 2 });
}

/**
 * Build a binary decision tree that explains which inputs separate runs that
 * pass an output filter ("in") from those that don't ("out").
 *
 * Numeric inputs only. For each input we evaluate every midpoint between
 * adjacent distinct values as a candidate split, then pick the split that
 * minimizes weighted Gini impurity. Recurses up to maxDepth.
 *
 * @param {Array} runs - rows of { inputs, outputs }
 * @param {(run) => boolean} isPositive - labels each run "in" (true) or "out"
 * @param {string[]} inputNames - candidate input names (typically varying & not pinned)
 * @param {{maxDepth?: number, minLeaf?: number}} opts
 * @returns tree node: { total, positive, split?: {name, threshold, leftMax, rightMin}, left?, right? }
 */
export function buildDecisionTree(runs, isPositive, inputNames, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const minLeaf = opts.minLeaf ?? 2;

  // Pre-compute numeric value access per input; skip non-numeric inputs entirely.
  const numericInputs = inputNames.filter(name =>
    runs.some(r => typeof toNum(r.inputs[name]) === 'number')
  );

  function gini(rs) {
    if (rs.length === 0) return 0;
    let pos = 0;
    for (const r of rs) if (isPositive(r)) pos++;
    const p = pos / rs.length;
    return 1 - p * p - (1 - p) * (1 - p);
  }

  function bestSplit(rs) {
    let best = null;
    const parentImpurity = gini(rs);
    for (const name of numericInputs) {
      const values = [];
      for (const r of rs) {
        const v = toNum(r.inputs[name]);
        if (v !== null) values.push(v);
      }
      if (values.length < 2) continue;
      const unique = [...new Set(values)].sort((a, b) => a - b);
      if (unique.length < 2) continue;
      for (let i = 0; i < unique.length - 1; i++) {
        const leftMax = unique[i];
        const rightMin = unique[i + 1];
        const threshold = (leftMax + rightMin) / 2;
        const left = [];
        const right = [];
        for (const r of rs) {
          const v = toNum(r.inputs[name]);
          if (v === null) continue;
          if (v <= threshold) left.push(r);
          else right.push(r);
        }
        if (left.length < minLeaf || right.length < minLeaf) continue;
        const w = (left.length * gini(left) + right.length * gini(right)) / rs.length;
        if (parentImpurity - w < 1e-9) continue; // no real improvement
        if (!best || w < best.weightedGini) {
          best = { name, threshold, leftMax, rightMin, left, right, weightedGini: w };
        }
      }
    }
    return best;
  }

  function nodeStats(rs) {
    let pos = 0;
    for (const r of rs) if (isPositive(r)) pos++;
    return { total: rs.length, positive: pos };
  }

  function build(rs, depth) {
    const stats = nodeStats(rs);
    const base = { ...stats, _runs: rs };
    if (depth >= maxDepth || stats.total < minLeaf * 2 || stats.positive === 0 || stats.positive === stats.total) {
      return base;
    }
    const split = bestSplit(rs);
    if (!split) return base;
    return {
      ...base,
      split: {
        name: split.name,
        threshold: split.threshold,
        leftMax: split.leftMax,
        rightMin: split.rightMin,
      },
      left: build(split.left, depth + 1),
      right: build(split.right, depth + 1),
    };
  }

  return build(runs, 0);
}

/**
 * Expand a single leaf one level deeper. Walks the tree to the given path
 * (e.g. "LR" = left then right), and if that node is a leaf with retained
 * runs, replaces it with a depth-1 subtree.  Stale paths are skipped silently.
 *
 * @param {object} tree - tree from buildDecisionTree
 * @param {string} path - "L"/"R" sequence; "" means root
 * @param {(run) => boolean} isPositive
 * @param {string[]} inputNames
 * @param {{minLeaf?: number}} opts
 * @returns the (mutated) tree
 */
export function expandTreeNode(tree, path, isPositive, inputNames, opts = {}) {
  let parent = null;
  let lastKey = null;
  let node = tree;
  for (const c of path) {
    const key = c === 'L' ? 'left' : c === 'R' ? 'right' : null;
    if (!key || !node[key]) return tree;
    parent = node;
    lastKey = key;
    node = node[key];
  }
  if (node.split || !node._runs) return tree; // already split or no runs to work with
  const sub = buildDecisionTree(node._runs, isPositive, inputNames, { maxDepth: 1, minLeaf: opts.minLeaf ?? 2 });
  if (!sub.split) return tree; // nothing useful to split on
  if (parent === null) {
    // expanding root — overwrite tree fields
    Object.assign(tree, sub);
  } else {
    parent[lastKey] = sub;
  }
  return tree;
}

function toNum(v) {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return null;
}
