import { describe, expect, test } from 'bun:test';
import {
  buildSwapActions,
  formatTaskProgress,
} from './reindex_with_alias_swap';

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

describe('formatTaskProgress', () => {
  test('empty status renders sensibly', () => {
    expect(formatTaskProgress({})).toBe('[0s] 0/0 (?)');
  });

  test('mid-run progress shows percent and elapsed', () => {
    const line = formatTaskProgress({
      total: 1000,
      created: 250,
      updated: 50,
      running_time_in_nanos: 12_000_000_000,
    });
    expect(line).toBe('[12s] 300/1000 (30.0%)');
  });

  test('appends conflicts only when non-zero', () => {
    expect(
      formatTaskProgress({
        total: 100,
        created: 100,
        version_conflicts: 0,
        running_time_in_nanos: 5_000_000_000,
      })
    ).toBe('[5s] 100/100 (100.0%)');
    expect(
      formatTaskProgress({
        total: 100,
        created: 90,
        version_conflicts: 3,
        running_time_in_nanos: 5_000_000_000,
      })
    ).toBe('[5s] 90/100 (90.0%) conflicts=3');
  });
});
