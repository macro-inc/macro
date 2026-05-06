import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@app/component/next-soup/filters/filters', () => ({
  SOUP_FILTERS: {},
  FILTER_GROUPS: [],
}));

vi.mock('@app/component/next-soup/filters', () => ({
  createFilterState: vi.fn(() => ({
    active: () => [],
    isActive: () => false,
    toggle: vi.fn(),
    setAll: vi.fn(),
    clear: vi.fn(),
    available: {},
  })),
}));

vi.mock('@app/component/next-soup/soup-view/sort-options', () => ({
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

import { createSoupState } from './create-soup-state';
import type { EntityData } from '../../../entity/src';

const createTestEntity = (id: string, name?: string): EntityData => ({
  id,
  type: 'document',
  name: name ?? `Entity ${id}`,
  ownerId: 'test-owner',
  updatedAt: new Date(),
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
        state.setRows(entities.map((e) => state.buildRow(e)));

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

        state.setRows(entities.map((e) => state.buildRow(e)));

        expect(state.rows().map((r) => r.original)).toEqual(entities);

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
        state.setRows([entity1, entity2].map((e) => state.buildRow(e)));

        expect(state.items.get('1')?.original).toBe(entity1);
        expect(state.items.get('2')?.original).toBe(entity2);
        expect(state.items.get('nonexistent')).toBeUndefined();

        dispose();
      });
    });

    it('should get row at index', () => {
      createRoot((dispose) => {
        const entity1 = createTestEntity('1');
        const entity2 = createTestEntity('2');
        const state = createSoupState({});

        expect(state.items.at(0)?.original).toBe(entity1);
        expect(state.items.at(1)?.original).toBe(entity2);
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
        expect(state.focus.item()).toBe(entity);
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
        expect(result1?.row.original).toBe(entities[0]);
        expect(result1?.index).toBe(0);

        const result2 = state.navigate.down();
        expect(result2?.row.original).toBe(entities[1]);
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
        expect(result1?.row.original).toBe(entities[2]);
        expect(result1?.index).toBe(2);

        const result2 = state.navigate.up();
        expect(result2?.row.original).toBe(entities[1]);
        expect(result2?.index).toBe(1);

        dispose();
      });
    });

    it('should navigate to first', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({ initialData: entities });

        state.focus.set('2');
        const result = state.navigate.toFirst();

        expect(result?.row.original).toBe(entities[0]);
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

        expect(result?.row.original).toBe(entities[1]);
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

        expect(result?.row.original).toBe(entities[1]);
        expect(state.focus.id()).toBe('2');

        dispose();
      });
    });

    it('should navigate to specific id', () => {
      createRoot((dispose) => {
        const entities = [createTestEntity('1'), createTestEntity('2')];
        const state = createSoupState({ initialData: entities });

        const result = state.navigate.toId('2');

        expect(result?.row.original).toBe(entities[1]);
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
        expect(peeked?.row.original).toBe(entities[2]);

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

  describe('previewEntity', () => {
    it('should manage preview entity state', () => {
      createRoot((dispose) => {
        const state = createSoupState();

        expect(state.previewEntity()).toBeUndefined();

        state.setPreviewEntity('entity-1');
        expect(state.previewEntity()).toBe('entity-1');

        state.setPreviewEntity(undefined);
        expect(state.previewEntity()).toBeUndefined();

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
