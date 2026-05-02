/**
 * @file Indicator Keys
 * @description Reference-indicator visibility prefs shared by grid (consumer)
 * and top-controls Settings (UI). Keys map to localStorage `sc-show-${key}`.
 */

export const INDICATOR_KEYS = [
  { key: 'precedent-boxes', label: 'Highlight precedent cells' },
  { key: 'dependent-boxes', label: 'Highlight dependent cells' },
  { key: 'precedent-arrows', label: 'Off-screen precedent arrows' },
  { key: 'dependent-arrows', label: 'Off-screen dependent arrows' },
];

export function isIndicatorEnabled(key) {
  return localStorage.getItem(`sc-show-${key}`) !== 'false';
}

export function setIndicatorEnabled(key, enabled) {
  localStorage.setItem(`sc-show-${key}`, enabled ? 'true' : 'false');
}
