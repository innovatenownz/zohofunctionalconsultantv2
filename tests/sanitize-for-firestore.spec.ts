import { test, expect } from '@playwright/test';
import { sanitizeForFirestore } from '../src/lib/project-service';

// Firestore rejects documents deeper than 20 levels or containing cycles.
// These are pure unit tests (no browser/page) guarding the sanitizer that
// logActivity() runs over arbitrary MCP tool results before persisting them.

function maxDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let deepest = depth;
  for (const child of children) {
    deepest = Math.max(deepest, maxDepth(child, depth + 1));
  }
  return deepest;
}

test.describe('sanitizeForFirestore', () => {
  test('caps depth well under the Firestore 20-level limit', () => {
    let deep: any = { leaf: 'bottom' };
    for (let i = 0; i < 25; i++) {
      deep = { level: i, child: deep };
    }

    const sanitized = sanitizeForFirestore(deep);

    expect(maxDepth(sanitized)).toBeLessThanOrEqual(20);
    // Over-deep branches collapse to a string, so the whole thing round-trips.
    expect(() => JSON.parse(JSON.stringify(sanitized))).not.toThrow();
  });

  test('breaks cycles instead of throwing', () => {
    const node: any = { name: 'root', tags: ['a', 'b'] };
    node.self = node;
    node.child = { parent: node };

    const sanitized = sanitizeForFirestore(node);

    expect(() => JSON.stringify(sanitized)).not.toThrow();
    expect(JSON.stringify(sanitized)).toContain('[circular]');
  });

  test('preserves sibling references to the same object (not a real cycle)', () => {
    const shared = { id: 42, label: 'shared' };
    const sanitized = sanitizeForFirestore({ a: shared, b: shared });

    expect(sanitized.a).toEqual({ id: 42, label: 'shared' });
    expect(sanitized.b).toEqual({ id: 42, label: 'shared' });
    expect(JSON.stringify(sanitized)).not.toContain('[circular]');
  });

  test('truncates oversized strings', () => {
    const big = 'x'.repeat(20000);
    const sanitized = sanitizeForFirestore({ note: big });

    expect(sanitized.note.length).toBeLessThan(6000);
    expect(sanitized.note).toContain('truncated');
  });

  test('chat message path allows compact list_tools sized content (50k)', () => {
    const big = 'y'.repeat(29000);
    const sanitized = sanitizeForFirestore(
      { role: 'agent', content: big },
      0,
      new WeakSet(),
      { maxStringLength: 50_000 }
    );
    expect(sanitized.content).toBe(big);
    expect(sanitized.content).not.toContain('truncated');
  });

  test('truncates oversized arrays and appends a marker', () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const sanitized = sanitizeForFirestore({ items });

    // 100 kept items + 1 truncation marker.
    expect(sanitized.items).toHaveLength(101);
    expect(sanitized.items[100]).toContain('more items truncated');
  });

  test('leaves normal shallow metadata untouched', () => {
    const metadata = {
      command: { action: 'ZohoCRM_putFieldsWithId', payload: { id: '123', fields: { name: 'Deal' } } },
      result: { status: 'ok', data: [{ id: 1 }, { id: 2 }] },
    };

    expect(sanitizeForFirestore(metadata)).toEqual(metadata);
  });

  test('normalizes null/undefined to null and passes primitives through', () => {
    expect(sanitizeForFirestore(null)).toBeNull();
    expect(sanitizeForFirestore(undefined)).toBeNull();
    expect(sanitizeForFirestore(42)).toBe(42);
    expect(sanitizeForFirestore(true)).toBe(true);
    expect(sanitizeForFirestore('short')).toBe('short');
  });
});
