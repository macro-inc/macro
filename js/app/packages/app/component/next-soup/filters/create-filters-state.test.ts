import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createFiltersState,
  EXCLUDE,
  NIL_UUID,
  type FilterConfig,
} from './create-filters-state';

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
  describe('EXCLUDE constant', () => {
    it('should be an array with NIL_UUID', () => {
      expect(EXCLUDE).toEqual([NIL_UUID]);
      expect(EXCLUDE[0]).toBe('00000000-0000-0000-0000-000000000000');
    });
  });

  describe('initialization', () => {
    it('should start with empty predicates by default', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        expect(filters.predicates()).toEqual([]);
        expect(filters.predicateFns()).toEqual([]);
        expect(filters.active()).toEqual([]);
        dispose();
      });
    });

    it('should start with empty query by default', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        expect(filters.query()).toEqual({});
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
        expect(filters.predicateFns()).toHaveLength(2);
        expect(filters.active()).toHaveLength(2);
        dispose();
      });
    });

    it('should accept initial query filters', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialQuery: { document_filters: { project_ids: ['p1'] } },
        });
        expect(filters.query()).toEqual({
          document_filters: { project_ids: ['p1'] },
        });
        dispose();
      });
    });

    it('should accept both initial predicates and query', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even'],
          initialQuery: { chat_filters: { chat_ids: ['c1'] } },
        });
        expect(filters.predicates()).toEqual(['even']);
        expect(filters.query()).toEqual({ chat_filters: { chat_ids: ['c1'] } });
        dispose();
      });
    });
  });

  describe('set', () => {
    it('should set predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.set({ predicates: ['even', 'small'] });
        expect(filters.predicates()).toEqual(['even', 'small']);
        dispose();
      });
    });

    it('should set query filters', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.set({ query: { chat_filters: { chat_ids: ['c1'] } } });
        expect(filters.query()).toEqual({ chat_filters: { chat_ids: ['c1'] } });
        dispose();
      });
    });

    it('should set both predicates and query', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.set({
          predicates: ['positive'],
          query: { email_filters: { recipients: ['a@b.com'] } },
        });
        expect(filters.predicates()).toEqual(['positive']);
        expect(filters.query()).toEqual({
          email_filters: { recipients: ['a@b.com'] },
        });
        dispose();
      });
    });

    it('should replace predicates, not merge', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        filters.set({ predicates: ['small'] });
        expect(filters.predicates()).toEqual(['small']);
        dispose();
      });
    });

    it('should replace query filters, not merge', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialQuery: { document_filters: { project_ids: ['p1'] } },
        });
        filters.set({ query: { chat_filters: { chat_ids: ['c1'] } } });
        expect(filters.query()).toEqual({ chat_filters: { chat_ids: ['c1'] } });
        dispose();
      });
    });

    it('should not change predicates if only query provided', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even'],
        });
        filters.set({ query: { chat_filters: { chat_ids: ['c1'] } } });
        expect(filters.predicates()).toEqual(['even']);
        dispose();
      });
    });

    it('should not change query if only predicates provided', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialQuery: { document_filters: { project_ids: ['p1'] } },
        });
        filters.set({ predicates: ['small'] });
        expect(filters.query()).toEqual({
          document_filters: { project_ids: ['p1'] },
        });
        dispose();
      });
    });

    it('should support EXCLUDE constant in query', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        filters.set({
          query: {
            document_filters: { document_ids: [] },
            chat_filters: { chat_ids: [...EXCLUDE] },
          },
        });
        expect(filters.query()).toEqual({
          document_filters: { document_ids: [] },
          chat_filters: { chat_ids: [NIL_UUID] },
        });
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
        filters.set({ predicates: ['even'] });
        expect(filters.isActive('even')).toBe(true);
        dispose();
      });
    });
  });

  describe('getConfig', () => {
    it('should return config for valid ID', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        const config = filters.getConfig('even');
        expect(config).toEqual(mockConfigs[0]);
        dispose();
      });
    });

    it('should return undefined for invalid ID', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({ configs: mockConfigs });
        expect(filters.getConfig('nonexistent')).toBeUndefined();
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
        expect(filters.predicateFns()).toHaveLength(2);
        dispose();
      });
    });
  });

  describe('predicateFns', () => {
    it('should return working predicate functions', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        const fns = filters.predicateFns();
        expect(fns).toHaveLength(2);

        const testEntity: TestEntity = { id: '1', value: 4, type: 'a' };
        expect(fns[0](testEntity)).toBe(true); // even: 4 % 2 === 0
        expect(fns[1](testEntity)).toBe(true); // positive: 4 > 0

        const testEntity2: TestEntity = { id: '2', value: 3, type: 'a' };
        expect(fns[0](testEntity2)).toBe(false); // even: 3 % 2 !== 0
        expect(fns[1](testEntity2)).toBe(true); // positive: 3 > 0
        dispose();
      });
    });

    it('should work for filtering arrays', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'small'],
        });

        const entities: TestEntity[] = [
          { id: '1', value: 2, type: 'a' }, // even, small
          { id: '2', value: 4, type: 'a' }, // even, small
          { id: '3', value: 12, type: 'a' }, // even, NOT small
          { id: '4', value: 3, type: 'a' }, // NOT even, small
        ];

        const filtered = entities.filter((e) =>
          filters.predicateFns().every((fn) => fn(e))
        );

        expect(filtered).toHaveLength(2);
        expect(filtered.map((e) => e.id)).toEqual(['1', '2']);
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

  describe('activeIds (alias)', () => {
    it('should be an alias for predicates', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even', 'positive'],
        });
        expect(filters.activeIds()).toEqual(filters.predicates());
        expect(filters.activeIds()).toEqual(['even', 'positive']);
        dispose();
      });
    });
  });

  describe('clear', () => {
    it('should clear predicates and query', () => {
      createRoot((dispose) => {
        const filters = createFiltersState({
          configs: mockConfigs,
          initialPredicates: ['even'],
          initialQuery: { document_filters: { project_ids: ['p1'] } },
        });

        // Verify initial state
        expect(filters.predicates()).toEqual(['even']);
        expect(filters.query()).toEqual({
          document_filters: { project_ids: ['p1'] },
        });

        filters.clear();

        // After clear, signals should be empty
        expect(filters.predicates()).toEqual([]);
        expect(filters.query()).toEqual({});

        dispose();
      });
    });
  });
});
