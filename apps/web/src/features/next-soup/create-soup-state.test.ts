import { createComputed, createRoot } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@app/features/next-soup/filters/configs/', () => ({
  SOUP_FILTERS: [],
}));

vi.mock('@app/features/next-soup/soup-view/sort-options', () => ({
  SORT_CONFIGS: {
    updated_at: {
      id: 'updated_at',
      fn: (a: { updatedAt?: number }, b: { updatedAt?: number }) =>
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    },
  },
}));

vi.mock('@core/mobile/inputModality', () => ({
  isModality: vi.fn(() => false),
}));

vi.mock('@core/component/EntityIcon', () => ({
  getIconConfig: vi.fn(),
}));

import type { EntityData } from '@entity';
import {
  createSoupState,
  type GroupMeta,
  type SoupState,
} from './create-soup-state';

const createTestEntity = (id: string, name?: string): EntityData => ({
  id,
  type: 'document',
  name: name ?? `Entity ${id}`,
  ownerId: 'test-owner',
  updatedAt: new Date(),
});

const createTestGroup = (key: string, count: number): GroupMeta => ({
  key,
  label: key,
  value: key,
  count,
  isExpanded: () => true,
  toggle: () => {},
});

const buildTestRow = (
  state: SoupState,
  original: EntityData,
  index: number,
  group?: GroupMeta,
  kind: 'entity' | 'header' | 'load-more' = 'entity'
) =>
  state.buildRow({
    id:
      kind === 'header'
        ? `header:${group?.key}`
        : kind === 'load-more'
          ? `loadmore:${group?.key}`
          : original.id,
    index,
    original,
    group,
    isGrouped: kind === 'header',
    isLoadMore: kind === 'load-more',
  });

describe('createSoupState', () => {
  describe('initial state', () => {
    it('should start with empty rows', () => {
      createRoot((dispose) => {
        const state = createSoupState();

        expect(state.rows()).toEqual([]);
        expect(state.items.count()).toBe(0);

        dispose();
      });
    });

    it('should accept initial rows via setRows', () => {
      createRoot((dispose) => {
        const state = createSoupState();
        const entities = [createTestEntity('1'), createTestEntity('2')];
        state.setRows(
          entities.map((e, i) =>
            state.buildRow({ id: e.id, index: i, original: e })
          )
        );

        expect(state.rows().map((r) => r.original)).toEqual(entities);
        expect(state.items.count()).toBe(2);

        dispose();
      });
    });
  });

  describe('setRows', () => {
    it('should update rows', () => {
      createRoot((dispose) => {
        const state = createSoupState();
        const entities = [createTestEntity('1'), createTestEntity('2')];

        state.setRows(
          entities.map((e, i) =>
            state.buildRow({ id: e.id, index: i, original: e })
          )
        );

        expect(state.rows().map((r) => r.original)).toEqual(entities);

        dispose();
      });
    });

    it('preserves a row proxy while updating its entity reactively', () => {
      createRoot((dispose) => {
        const state = createSoupState();
        const before = createTestEntity('1', 'Before');
        const second = createTestEntity('2', 'Second');
        state.setRows([
          state.buildRow({ id: before.id, index: 0, original: before }),
          state.buildRow({ id: second.id, index: 1, original: second }),
        ]);

        const storedRow = state.rows()[0];
        const secondStoredRow = state.rows()[1];
        state.focus.set('1');
        const observedNames: string[] = [];
        let rowUpdates = 0;
        createComputed(() => {
          observedNames.push(storedRow.original.name);
        });
        createComputed(() => {
          state.rows();
          rowUpdates += 1;
        });

        const after = createTestEntity('1', 'After');
        state.setRows([
          state.buildRow({
            id: second.id,
            index: 0,
            original: createTestEntity('2', 'Second'),
          }),
          state.buildRow({ id: after.id, index: 1, original: after }),
        ]);

        expect(state.rows()[0]).toBe(secondStoredRow);
        expect(state.rows()[1]).toBe(storedRow);
        expect(storedRow.index).toBe(1);
        expect(storedRow.isFocused()).toBe(true);
        expect(state.focus.index()).toBe(1);
        expect(storedRow.original.name).toBe('After');
        expect(observedNames).toEqual(['Before', 'After']);
        expect(rowUpdates).toBe(2);

        dispose();
      });
    });

    it('uses composite identities for task moves and structural rows', () => {
      createRoot((dispose) => {
        const state = createSoupState();
        const groupA = createTestGroup('a', 2);
        const groupB = createTestGroup('b', 1);
        const staysInA = createTestEntity('stays-a');
        const moved = createTestEntity('moved');
        const staysInB = createTestEntity('stays-b');

        state.setRows([
          buildTestRow(state, staysInA, 0, groupA, 'header'),
          buildTestRow(state, staysInA, 1, groupA),
          buildTestRow(state, moved, 2, groupA),
          buildTestRow(state, staysInB, 3, groupB, 'header'),
          buildTestRow(state, staysInB, 4, groupB),
          buildTestRow(state, staysInB, 5, groupB, 'load-more'),
        ]);

        const [headerA, , movedInA, headerB, staysInBRow, loadMoreB] =
          state.rows();
        const staysInARow = state.rows()[1];
        const nextGroupA = createTestGroup('a', 1);
        const nextGroupB = createTestGroup('b', 2);
        const movedAfterUpdate = createTestEntity('moved');

        state.setRows([
          buildTestRow(
            state,
            createTestEntity('stays-a'),
            0,
            nextGroupA,
            'header'
          ),
          buildTestRow(state, createTestEntity('stays-a'), 1, nextGroupA),
          buildTestRow(state, movedAfterUpdate, 2, nextGroupB, 'header'),
          buildTestRow(state, movedAfterUpdate, 3, nextGroupB),
          buildTestRow(state, createTestEntity('stays-b'), 4, nextGroupB),
          buildTestRow(
            state,
            createTestEntity('stays-b'),
            5,
            nextGroupB,
            'load-more'
          ),
        ]);

        expect(state.rows()[0]).toBe(headerA);
        expect(state.rows()[0].group?.count).toBe(1);
        expect(state.rows()[1]).toBe(staysInARow);
        expect(state.rows()[1].index).toBe(1);
        expect(state.rows()[2]).not.toBe(headerB);
        expect(state.rows()[2].original.id).toBe('moved');
        expect(state.rows()[2].group?.count).toBe(2);
        expect(state.rows()[3]).not.toBe(movedInA);
        expect(state.rows()[4]).toBe(staysInBRow);
        expect(state.rows()[4].original.id).toBe('stays-b');
        expect(state.rows()[5]).toBe(loadMoreB);
        expect(state.rows()[5].group?.count).toBe(2);

        dispose();
      });
    });

    it('preserves focus on the same duplicate row after reconciliation', () => {
      createRoot((dispose) => {
        const state = createSoupState();
        const entity = createTestEntity('duplicate');
        const groups = [
          createTestGroup('first', 1),
          createTestGroup('second', 1),
        ];
        const buildRows = () =>
          groups.map((group, index) =>
            state.buildRow({
              id: entity.id,
              index,
              original: entity,
              group,
            })
          );

        state.setRows(buildRows());
        state.focus.setIndex(1);
        state.setRows(buildRows());

        expect(state.focus.index()).toBe(1);
        expect(state.focus.row()?.group?.key).toBe('second');

        dispose();
      });
    });
  });

  describe('items', () => {
    it('should get row by id', () => {
      createRoot((dispose) => {
        const entity1 = createTestEntity('1');
        const entity2 = createTestEntity('2');
        const state = createSoupState();
        state.setRows(
          [entity1, entity2].map((e, i) =>
            state.buildRow({ id: e.id, index: i, original: e })
          )
        );

        expect(unwrap(state.items.get('1')?.original)).toBe(entity1);
        expect(unwrap(state.items.get('2')?.original)).toBe(entity2);
        expect(state.items.get('nonexistent')).toBeUndefined();

        dispose();
      });
    });

    it('should get row at index', () => {
      createRoot((dispose) => {
        const entity1 = createTestEntity('1');
        const entity2 = createTestEntity('2');
        const state = createSoupState({
          initialData: [entity1, entity2],
        });

        expect(unwrap(state.items.at(0)?.original)).toBe(entity1);
        expect(unwrap(state.items.at(1)?.original)).toBe(entity2);
        expect(state.items.at(99)).toBeUndefined();

        dispose();
      });
    });

    it('should get index of item by id', () => {
      createRoot((dispose) => {
        const state = createSoupState({
          initialData: [createTestEntity('1'), createTestEntity('2')],
        });

        expect(state.items.indexOf('1')).toBe(0);
        expect(state.items.indexOf('2')).toBe(1);
        expect(state.items.indexOf('nonexistent')).toBe(-1);

        dispose();
      });
    });
  });

  describe('focus', () => {
    it('should start with no focus', () => {
      createRoot((dispose) => {
        const state = createSoupState({
          initialData: [createTestEntity('1')],
        });

        expect(state.focus.id()).toBeUndefined();
        expect(state.focus.item()).toBeUndefined();
        expect(state.focus.index()).toBe(-1);

        dispose();
      });
    });

    it('should set focus by id', () => {
      createRoot((dispose) => {
        const entity = createTestEntity('1');
        const state = createSoupState({ initialData: [entity] });

        state.focus.set('1');

        expect(state.focus.id()).toBe('1');
        expect(unwrap(state.focus.item())).toBe(entity);
        expect(state.focus.index()).toBe(0);

        dispose();
      });
    });

    it('should clear focus', () => {
      createRoot((dispose) => {
        const state = createSoupState({
          initialData: [createTestEntity('1')],
        });

        state.focus.set('1');
        state.focus.clear();

        expect(state.focus.id()).toBeUndefined();
        expect(state.focus.item()).toBeUndefined();

        dispose();
      });
    });
  });

  describe('navigate', () => {
    it('should navigate down', () => {
      createRoot((dispose) => {
        const entities = [
          createTestEntity('1'),
          createTestEntity('2'),
          createTestEntity('3'),
        ];
        const state = createSoupState({ initialData: entities });

        const result1 = state.navigate.down();
        expect(unwrap(result1?.row.original)).toBe(entities[0]);
        expect(result1?.index).toBe(0);

        const result2 = state.navigate.down();
        expect(unwrap(result2?.row.original)).toBe(entities[1]);
        expect(result2?.index).toBe(1);

        dispose();
      });
    });

    it('should navigate up', () => {
      createRoot((dispose) => {
        const entities = [
          createTestEntity('1'),
          createTestEntity('2'),
          createTestEntity('3'),
        ];
        const state = createSoupState({ initialData: entities });

        // When no focus, up goes to last
        const result1 = state.navigate.up();
        expect(unwrap(result1?.row.original)).toBe(entities[2]);
        expect(result1?.index).toBe(2);

        const result2 = state.navigate.up();
        expect(unwrap(result2?.row.original)).toBe(entities[1]);
        expect(result2?.index).toBe(1);

        dispose();
      });
    });

    it('should skip rows rejected by the navigation predicate', () => {
      createRoot((dispose) => {
        const entities = [
          createTestEntity('1'),
          createTestEntity('2'),
          createTestEntity('3'),
        ];
        const state = createSoupState({ initialData: entities });
        state.focus.set('1');

        const result = state.navigate.down({
          skip: (row) => row.id === '2',
        });

        expect(unwrap(result?.row.original)).toBe(entities[2]);
        expect(state.focus.id()).toBe('3');

        dispose();
      });
    });

    it('should navigate to first', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({ initialData: entities });

        state.focus.set('2');
        const result = state.navigate.toFirst();

        expect(unwrap(result?.row.original)).toBe(entities[0]);
        expect(state.focus.id()).toBe('1');

        dispose();
      });
    });

    it('should navigate to last', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({ initialData: entities });

        state.focus.set('1');
        const result = state.navigate.toLast();

        expect(unwrap(result?.row.original)).toBe(entities[1]);
        expect(state.focus.id()).toBe('2');

        dispose();
      });
    });

    it('should navigate to specific index', () => {
      createRoot((dispose) => {
        const entities = [
          createTestEntity('1'),
          createTestEntity('2'),
          createTestEntity('3'),
        ];
        const state = createSoupState({ initialData: entities });

        const result = state.navigate.toIndex(1);

        expect(unwrap(result?.row.original)).toBe(entities[1]);
        expect(state.focus.id()).toBe('2');

        dispose();
      });
    });

    it('should navigate to specific id', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({ initialData: entities });

        const result = state.navigate.toId('2');

        expect(unwrap(result?.row.original)).toBe(entities[1]);
        expect(state.focus.id()).toBe('2');

        dispose();
      });
    });

    it('should return undefined for invalid id', () => {
      createRoot((dispose) => {
        const state = createSoupState({
          initialData: [createTestEntity('1')],
        });

        const result = state.navigate.toId('nonexistent');

        expect(result).toBeUndefined();

        dispose();
      });
    });

    it('should clamp to bounds without wrapping', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({
          initialData: entities,
          wrapNavigation: false,
        });

        // Navigate past end
        state.navigate.toIndex(99);
        expect(state.focus.id()).toBe('2');

        // Navigate before start
        state.navigate.toIndex(-99);
        expect(state.focus.id()).toBe('1');

        dispose();
      });
    });

    it('should wrap around with wrapNavigation enabled', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({
          initialData: entities,
          wrapNavigation: true,
        });

        // Start at last item
        state.navigate.toLast();
        expect(state.focus.id()).toBe('2');

        // Navigate down should wrap to first
        state.navigate.down();
        expect(state.focus.id()).toBe('1');

        // Navigate up should wrap to last
        state.navigate.up();
        expect(state.focus.id()).toBe('2');

        dispose();
      });
    });

    it('should peek offset without changing focus', () => {
      createRoot((dispose) => {
        const entities = [
          createTestEntity('1'),
          createTestEntity('2'),
          createTestEntity('3'),
        ];
        const state = createSoupState({ initialData: entities });

        state.navigate.toIndex(1);
        expect(state.focus.id()).toBe('2');

        const peeked = state.navigate.peekOffset(1);
        expect(unwrap(peeked?.row.original)).toBe(entities[2]);

        // Focus should remain unchanged
        expect(state.focus.id()).toBe('2');

        dispose();
      });
    });

    it('should return undefined when navigating empty data', () => {
      createRoot((dispose) => {
        const state = createSoupState({ initialData: [] });

        expect(state.navigate.down()).toBeUndefined();
        expect(state.navigate.up()).toBeUndefined();
        expect(state.navigate.toFirst()).toBeUndefined();

        dispose();
      });
    });
  });

  describe('selection', () => {
    it('should expose selection state', () => {
      createRoot((dispose) => {
        const entity = createTestEntity('1');
        const state = createSoupState({ initialData: [entity] });

        expect(state.selection.count()).toBe(0);

        state.selection.select(entity);
        expect(state.selection.count()).toBe(1);
        expect(state.selection.isSelected('1')).toBe(true);

        dispose();
      });
    });
  });

  describe('sort', () => {
    it('should expose sort state', () => {
      createRoot((dispose) => {
        const state = createSoupState();

        // Initial sort should be updated_at
        expect(state.sort.active().length).toBe(1);
        expect(state.sort.active()[0].id).toBe('updated_at');

        dispose();
      });
    });
  });

  describe('grouping', () => {
    it('should manage group expansion state', () => {
      createRoot((dispose) => {
        const state = createSoupState();

        // Groups start expanded
        expect(state.grouping.isExpanded('group-1')).toBe(true);

        // Toggle to collapse
        state.grouping.toggle('group-1');
        expect(state.grouping.isExpanded('group-1')).toBe(false);

        // Toggle to expand
        state.grouping.toggle('group-1');
        expect(state.grouping.isExpanded('group-1')).toBe(true);

        dispose();
      });
    });

    it('should collapse and expand all groups', () => {
      createRoot((dispose) => {
        const state = createSoupState();

        state.grouping.collapseAll(['group-1', 'group-2']);
        expect(state.grouping.isExpanded('group-1')).toBe(false);
        expect(state.grouping.isExpanded('group-2')).toBe(false);

        state.grouping.expandAll();
        expect(state.grouping.isExpanded('group-1')).toBe(true);
        expect(state.grouping.isExpanded('group-2')).toBe(true);

        dispose();
      });
    });
  });
});
