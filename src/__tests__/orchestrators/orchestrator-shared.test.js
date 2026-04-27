/**
 * Tests for orchestrator-shared.js
 * Covers validateImportUrl protocol and format validation.
 */

import { validateImportUrl } from '../../orchestrators/shared/orchestrator-shared.js';

describe('validateImportUrl', () => {
  it('accepts https URLs', () => {
    const url = validateImportUrl('https://example.com/file.zip');
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe('https:');
  });

  it('accepts http URLs', () => {
    const url = validateImportUrl('http://example.com/file.zip');
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe('http:');
  });

  it('rejects javascript: protocol', () => {
    expect(() => validateImportUrl('javascript:alert(1)')).toThrow('Unsupported protocol');
  });

  it('rejects data: protocol', () => {
    expect(() => validateImportUrl('data:text/html,<h1>hi</h1>')).toThrow('Unsupported protocol');
  });

  it('rejects file: protocol', () => {
    expect(() => validateImportUrl('file:///etc/passwd')).toThrow('Unsupported protocol');
  });

  it('rejects ftp: protocol', () => {
    expect(() => validateImportUrl('ftp://example.com/file.zip')).toThrow('Unsupported protocol');
  });

  it('throws on malformed URLs', () => {
    expect(() => validateImportUrl('not-a-url')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => validateImportUrl('')).toThrow();
  });

  it('preserves query parameters and path', () => {
    const url = validateImportUrl('https://example.com/path/file.zip?token=abc');
    expect(url.pathname).toBe('/path/file.zip');
    expect(url.searchParams.get('token')).toBe('abc');
  });
});
