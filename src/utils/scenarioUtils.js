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
