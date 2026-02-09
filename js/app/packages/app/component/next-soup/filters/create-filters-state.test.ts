import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createFiltersState, type FilterConfig } from './create-filters-state';

type TestEntity = { id: string; value: number; type: string };

const mockConfigs: FilterConfig<TestEntity>[] = [
  { id: 'even', label: 'Even', predicate: (e) => e.value % 2 === 0 },
  { id: 'positive', label: 'Positive', predicate: (e) => e.value > 0 },
  { id: 'small', label: 'Small', predicate: (e) => e.value < 10 },
  {
    id: 'typeA',
    label: 'Type A',
    predicate: (e) => e.type === 'a',
    group: 'type',
  },
  {
    id: 'typeB',
    label: 'Type B',
    predicate: (e) => e.type === 'b',
    group: 'type',
  },
];

describe('createFiltersState', () => {
  describe('initialization', () => {
    it('should start with empty predicates by default', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        expect(filters.predicates()).toEqual([]);
        expect(filters.active()).toEqual([]);
        dispose();
      });
    });

    it('should accept initial predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        expect(filters.predicates()).toEqual(['even', 'positive']);
        expect(filters.active()).toHaveLength(2);
        dispose();
      });
    });
  });

  describe('set', () => {
    it('should set predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.set(['even', 'small']);
        expect(filters.predicates()).toEqual(['even', 'small']);
        dispose();
      });
    });

    it('should replace predicates, not merge', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        filters.set(['small']);
        expect(filters.predicates()).toEqual(['small']);
        dispose();
      });
    });
  });

  describe('isActive', () => {
    it('should return true for active predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even'],
        });
        expect(filters.isActive('even')).toBe(true);
        expect(filters.isActive('positive')).toBe(false);
        dispose();
      });
    });

    it('should update when predicates change', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        expect(filters.isActive('even')).toBe(false);
        filters.set(['even']);
        expect(filters.isActive('even')).toBe(true);
        dispose();
      });
    });
  });

  describe('active', () => {
    it('should return full configs for active predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        const active = filters.active();
        expect(active).toHaveLength(2);
        expect(active[0]).toEqual(mockConfigs[0]); // even
        expect(active[1]).toEqual(mockConfigs[1]); // positive
        dispose();
      });
    });

    it('should preserve order of predicates array', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['positive', 'even'],
        });
        const active = filters.active();
        expect(active[0].id).toBe('positive');
        expect(active[1].id).toBe('even');
        dispose();
      });
    });

    it('should skip unknown predicate IDs', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'unknown', 'positive'],
        });
        expect(filters.active()).toHaveLength(2);
        dispose();
      });
    });
  });

  describe('available', () => {
    it('should expose all available configs', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        expect(filters.available).toBe(mockConfigs);
        expect(filters.available).toHaveLength(5);
        dispose();
      });
    });
  });

  describe('toggle', () => {
    it('should add predicate when not active', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.toggle('even');
        expect(filters.predicates()).toEqual(['even']);
        expect(filters.isActive('even')).toBe(true);
        dispose();
      });
    });

    it('should remove predicate when active', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        filters.toggle('even');
        expect(filters.predicates()).toEqual(['positive']);
        expect(filters.isActive('even')).toBe(false);
        dispose();
      });
    });

    it('should remove other filters in exclusive group when activating', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          groups: [{ id: 'type', allowMultiple: false }],
          initialPredicates: ['typeA'],
        });

        // typeA is active, toggle typeB
        filters.toggle('typeB');

        // typeA should be removed, typeB should be active
        expect(filters.predicates()).toEqual(['typeB']);
        expect(filters.isActive('typeA')).toBe(false);
        expect(filters.isActive('typeB')).toBe(true);
        dispose();
      });
    });

    it('should not remove other filters in non-exclusive group', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          groups: [{ id: 'type', allowMultiple: true }],
          initialPredicates: ['typeA'],
        });

        // typeA is active, toggle typeB
        filters.toggle('typeB');

        // Both should be active
        expect(filters.predicates()).toEqual(['typeA', 'typeB']);
        expect(filters.isActive('typeA')).toBe(true);
        expect(filters.isActive('typeB')).toBe(true);
        dispose();
      });
    });

    it('should not affect filters without groups', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          groups: [{ id: 'type', allowMultiple: false }],
          initialPredicates: ['even', 'typeA'],
        });

        // Toggle typeB - should remove typeA but not even
        filters.toggle('typeB');

        expect(filters.predicates()).toEqual(['even', 'typeB']);
        expect(filters.isActive('even')).toBe(true);
        expect(filters.isActive('typeA')).toBe(false);
        expect(filters.isActive('typeB')).toBe(true);
        dispose();
      });
    });
  });

  describe('activate', () => {
    it('should add predicate when not active', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.activate('even');
        expect(filters.predicates()).toEqual(['even']);
        dispose();
      });
    });

    it('should not duplicate when already active', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even'],
        });
        filters.activate('even');
        expect(filters.predicates()).toEqual(['even']);
        dispose();
      });
    });
  });

  describe('deactivate', () => {
    it('should remove predicate when active', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        filters.deactivate('even');
        expect(filters.predicates()).toEqual(['positive']);
        dispose();
      });
    });

    it('should do nothing when not active', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even'],
        });
        filters.deactivate('positive');
        expect(filters.predicates()).toEqual(['even']);
        dispose();
      });
    });
  });

  describe('clear', () => {
    it('should clear all predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });

        // Verify initial state
        expect(filters.predicates()).toEqual(['even', 'positive']);
        expect(filters.isActive('even')).toBe(true);

        filters.clear();

        // After clear, predicates should be empty
        expect(filters.predicates()).toEqual([]);
        expect(filters.isActive('even')).toBe(false);
        expect(filters.isActive('positive')).toBe(false);

        dispose();
      });
    });
  });
});
