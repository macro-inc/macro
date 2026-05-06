import { describe, expect, test } from 'bun:test';
import { buildSwapActions } from './reindex_with_alias_swap';

describe('buildSwapActions', () => {
  test('alias already in place — remove from old, add to new', () => {
    const actions = buildSwapActions({
      alias: 'documents',
      newIndex: 'documents_v2',
      oldIndex: 'documents_v1',
      aliasExists: true,
      aliasNameIsPhysicalIndex: false,
    });
    expect(actions).toEqual([
      { remove: { index: 'documents_v1', alias: 'documents' } },
      { add: { index: 'documents_v2', alias: 'documents' } },
    ]);
  });

  test('alias name is currently a physical index — remove_index then add', () => {
    const actions = buildSwapActions({
      alias: 'channels',
      newIndex: 'channels_v1',
      oldIndex: 'channels',
      aliasExists: false,
      aliasNameIsPhysicalIndex: true,
    });
    expect(actions).toEqual([
      { remove_index: { index: 'channels' } },
      { add: { index: 'channels_v1', alias: 'channels' } },
    ]);
  });

  test('first-time alias setup — just add', () => {
    const actions = buildSwapActions({
      alias: 'documents',
      newIndex: 'documents_v1',
      oldIndex: undefined,
      aliasExists: false,
      aliasNameIsPhysicalIndex: false,
    });
    expect(actions).toEqual([
      { add: { index: 'documents_v1', alias: 'documents' } },
    ]);
  });

  test('no-op swap (oldIndex === newIndex) skips remove', () => {
    const actions = buildSwapActions({
      alias: 'documents',
      newIndex: 'documents_v1',
      oldIndex: 'documents_v1',
      aliasExists: true,
      aliasNameIsPhysicalIndex: false,
    });
    expect(actions).toEqual([
      { add: { index: 'documents_v1', alias: 'documents' } },
    ]);
  });
});
