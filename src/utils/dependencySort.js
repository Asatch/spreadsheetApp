/**
 * Compute dependency depth for a set of sheets.
 *
 * Depth = max(depth of in-scope dependencies) + 1; no deps = 0.
 * Only dependencies whose functionId maps to a sheet in the input set are
 * considered (folder-scoped).
 *
 * @param {Array<{id: string, functionId: string|null, dependencies: string[]}>} sheets
 * @returns {Map<string, number>} sheetId -> depth
 */
export function computeDependencyDepths(sheets) {
  // Build lookup: functionId -> sheetId (only for sheets in scope)
  const funcToSheet = new Map();
  for (const s of sheets) {
    if (s.functionId) funcToSheet.set(s.functionId, s.id);
  }

  // Build adjacency: sheetId -> [dependent sheetIds within scope]
  const depsOf = new Map();
  for (const s of sheets) {
    const inScope = (s.dependencies || [])
      .map(fid => funcToSheet.get(fid))
      .filter(Boolean);
    depsOf.set(s.id, inScope);
  }

  const depths = new Map();

  function resolve(sheetId, visiting) {
    if (depths.has(sheetId)) return depths.get(sheetId);
    if (visiting.has(sheetId)) return 0; // cycle guard

    visiting.add(sheetId);
    const deps = depsOf.get(sheetId) || [];
    let maxChild = -1;
    for (const depId of deps) {
      maxChild = Math.max(maxChild, resolve(depId, visiting));
    }
    visiting.delete(sheetId);

    const depth = maxChild + 1;
    depths.set(sheetId, depth);
    return depth;
  }

  for (const s of sheets) {
    resolve(s.id, new Set());
  }

  return depths;
}
