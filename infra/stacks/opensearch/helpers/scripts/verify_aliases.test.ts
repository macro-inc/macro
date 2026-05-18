import { describe, expect, test } from 'bun:test';
import { evaluateAlias } from './verify_aliases';

describe('evaluateAlias', () => {
  test('alias missing entirely is FAIL', () => {
    const out = evaluateAlias({
      alias: 'documents',
      expectedIndex: 'documents_v1',
      actualIndices: [],
      aliasNameIsPhysicalIndex: false,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('does not exist');
  });

  test('alias name is currently a physical index is FAIL', () => {
    const out = evaluateAlias({
      alias: 'channels',
      expectedIndex: 'channels_v1',
      actualIndices: [],
      aliasNameIsPhysicalIndex: true,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('physical index');
  });

  test('alias points at unexpected index is FAIL', () => {
    const out = evaluateAlias({
      alias: 'emails',
      expectedIndex: 'emails_v1',
      actualIndices: ['emails_v2'],
      aliasNameIsPhysicalIndex: false,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('emails_v2');
  });

  test('alias points at multiple indices is FAIL', () => {
    const out = evaluateAlias({
      alias: 'emails',
      expectedIndex: 'emails_v1',
      actualIndices: ['emails_v1', 'emails_v2'],
      aliasNameIsPhysicalIndex: false,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('multiple');
  });

  test('alias points at expected index is OK', () => {
    const out = evaluateAlias({
      alias: 'emails',
      expectedIndex: 'emails_v1',
      actualIndices: ['emails_v1'],
      aliasNameIsPhysicalIndex: false,
    });
    expect(out.ok).toBe(true);
    expect(out.reason).toBeUndefined();
  });
});
