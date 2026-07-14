import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createSortState, type SortConfig } from './create-sort-state';

type Item = { name: string; date: number; priority: number };

const sortConfigs = {
  name: {
    id: 'name',
    fn: (a: Item, b: Item) => a.name.localeCompare(b.name),
  },
  date: {
    id: 'date',
    fn: (a: Item, b: Item) => a.date - b.date,
    desc: true,
  },
  priority: {
    id: 'priority',
    fn: (a: Item, b: Item) => a.priority - b.priority,
  },
} satisfies Record<string, SortConfig<Item>>;

describe('createSortState', () => {
  describe('initial state', () => {
    it('should start with no active sorts by default', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        expect(sort.active()).toEqual([]);

        dispose();
      });
    });

    it('should accept initial sort ids', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name', 'date']);

        expect(sort.active()).toEqual([sortConfigs.name, sortConfigs.date]);

        dispose();
      });
    });

    it('should ignore invalid initial sort ids', () => {
      createRoot((dispose) => {
        // @ts-expect-error - testing invalid id
        const sort = createSortState(sortConfigs, ['name', 'invalid']);

        expect(sort.active()).toEqual([sortConfigs.name]);

        dispose();
      });
    });

    it('should expose available configs', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        expect(sort.available).toBe(sortConfigs);

        dispose();
      });
    });
  });

  describe('isActive', () => {
    it('should return true for active sorts', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name']);

        expect(sort.isActive('name')).toBe(true);
        expect(sort.isActive('date')).toBe(false);

        dispose();
      });
    });
  });

  describe('toggle', () => {
    it('should add sort when not active', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        sort.toggle('name');

        expect(sort.active()).toEqual([sortConfigs.name]);
        expect(sort.isActive('name')).toBe(true);

        dispose();
      });
    });

    it('should remove sort when active', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name']);

        sort.toggle('name');

        expect(sort.active()).toEqual([]);
        expect(sort.isActive('name')).toBe(false);

        dispose();
      });
    });

    it('should force add with value=true', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        sort.toggle('name', true);

        expect(sort.isActive('name')).toBe(true);

        // Toggling again with true should keep it active
        sort.toggle('name', true);

        expect(sort.isActive('name')).toBe(true);

        dispose();
      });
    });

    it('should force remove with value=false', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name']);

        sort.toggle('name', false);

        expect(sort.isActive('name')).toBe(false);

        // Toggling again with false should keep it inactive
        sort.toggle('name', false);

        expect(sort.isActive('name')).toBe(false);

        dispose();
      });
    });

    it('should not add invalid sort id', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        // @ts-expect-error - testing invalid id
        sort.toggle('invalid');

        expect(sort.active()).toEqual([]);

        dispose();
      });
    });

    it('should append to existing sorts', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name']);

        sort.toggle('date');

        expect(sort.active()).toEqual([sortConfigs.name, sortConfigs.date]);

        dispose();
      });
    });
  });

  describe('setAll', () => {
    it('should replace all active sorts', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name']);

        sort.setAll(['date', 'priority']);

        expect(sort.active()).toEqual([sortConfigs.date, sortConfigs.priority]);

        dispose();
      });
    });

    it('should clear sorts when given empty array', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name', 'date']);

        sort.setAll([]);

        expect(sort.active()).toEqual([]);

        dispose();
      });
    });

    it('should filter out invalid ids', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        // @ts-expect-error - testing invalid id
        sort.setAll(['name', 'invalid', 'date']);

        expect(sort.active()).toEqual([sortConfigs.name, sortConfigs.date]);

        dispose();
      });
    });

    it('should preserve order of ids', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        sort.setAll(['priority', 'name', 'date']);

        expect(sort.active().map((s) => s.id)).toEqual([
          'priority',
          'name',
          'date',
        ]);

        dispose();
      });
    });
  });

  describe('clear', () => {
    it('should remove all active sorts', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name', 'date', 'priority']);

        sort.clear();

        expect(sort.active()).toEqual([]);

        dispose();
      });
    });

    it('should be a no-op when already empty', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs);

        sort.clear();

        expect(sort.active()).toEqual([]);

        dispose();
      });
    });
  });

  describe('sort function integration', () => {
    it('should provide working sort functions', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['name']);

        const items: Item[] = [
          { name: 'Charlie', date: 3, priority: 1 },
          { name: 'Alice', date: 1, priority: 3 },
          { name: 'Bob', date: 2, priority: 2 },
        ];

        const sortFn = sort.active()[0].fn;
        const sorted = [...items].sort(sortFn);

        expect(sorted.map((i) => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);

        dispose();
      });
    });

    it('should support descending sort via desc flag', () => {
      createRoot((dispose) => {
        const sort = createSortState(sortConfigs, ['date']);

        expect(sort.active()[0].desc).toBe(true);

        dispose();
      });
    });
  });
});
