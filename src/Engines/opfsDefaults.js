/**
 * Shared defaults for OPFS-like storage services.
 * Used by opfsService, memoryOpfsService, and serverOpfsService.
 */

export const DEFAULT_SHEET_MANIFEST = {
  version: '3.0',
  folders: {},
  sheets: {},
  scenarioAnalyses: {}
};

export const DEFAULT_LANGUAGE_PACK_MANIFEST = {
  version: '1.0',
  packs: {}
};
