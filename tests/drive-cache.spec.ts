import { test, expect } from '@playwright/test';
import { isDriveFolderUnchanged } from '../src/lib/drive-folder-unchanged';

// Pure unit tests for Drive folder change-detection used by /api/chat caching.
// (No browser; no live Drive calls.)

test.describe('isDriveFolderUnchanged', () => {
  test('returns true when ids and modifiedTimes match exactly (any order)', () => {
    const cached = [
      { id: 'a', modifiedTime: '2026-01-01T00:00:00.000Z' },
      { id: 'b', modifiedTime: '2026-01-02T00:00:00.000Z' },
    ];
    const current = [
      { id: 'b', modifiedTime: '2026-01-02T00:00:00.000Z' },
      { id: 'a', modifiedTime: '2026-01-01T00:00:00.000Z' },
    ];
    expect(isDriveFolderUnchanged(cached, current)).toBe(true);
  });

  test('returns false when a file was added', () => {
    const cached = [{ id: 'a', modifiedTime: 't1' }];
    const current = [
      { id: 'a', modifiedTime: 't1' },
      { id: 'b', modifiedTime: 't2' },
    ];
    expect(isDriveFolderUnchanged(cached, current)).toBe(false);
  });

  test('returns false when a file was removed', () => {
    const cached = [
      { id: 'a', modifiedTime: 't1' },
      { id: 'b', modifiedTime: 't2' },
    ];
    const current = [{ id: 'a', modifiedTime: 't1' }];
    expect(isDriveFolderUnchanged(cached, current)).toBe(false);
  });

  test('returns false when modifiedTime changed on an existing file', () => {
    const cached = [{ id: 'a', modifiedTime: 't1' }];
    const current = [{ id: 'a', modifiedTime: 't1-edited' }];
    expect(isDriveFolderUnchanged(cached, current)).toBe(false);
  });

  test('returns false for empty cache vs non-empty folder (first-message / no-cache case)', () => {
    expect(
      isDriveFolderUnchanged([], [{ id: 'a', modifiedTime: 't1' }])
    ).toBe(false);
  });

  test('returns true for empty folder vs empty cache', () => {
    expect(isDriveFolderUnchanged([], [])).toBe(true);
  });
});
