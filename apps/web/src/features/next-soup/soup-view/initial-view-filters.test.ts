import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createPredicatesStore } from '../filters/filter-store/predicates-store';
import { createQueryStore } from '../filters/filter-store/query-store';
import { resolveInitialViewFilters } from './initial-view-filters';

vi.mock('../sidebar/soup-filter-presets', () => ({
  getViewPreset: () => ({ filters: { include: { includeReminders: true } } }),
}));

it.each(['active', 'scheduled', 'done', undefined])(
  'migrates a %s reminder entry without leaking into the next split destination',
  (rememberedTab) =>
    createRoot((dispose) => {
      const query = createQueryStore();
      const predicates = createPredicatesStore({
        configs: [
          { id: 'reminders', predicate: () => true },
          { id: 'calls', predicate: () => true },
        ],
      });
      const initialize = (
        options: Parameters<typeof resolveInitialViewFilters>[0]
      ) => {
        const filters = resolveInitialViewFilters(options);
        query.replace(filters.query ?? null);
        predicates.set(filters.predicates ?? {});
      };
      const legacyEntry = {
        query: { include: { includeReminders: true, reminderCompleted: true } },
        predicates: { and: ['reminders-done'] },
      };
      initialize({
        view: 'reminders',
        rememberedTab,
        entry: legacyEntry,
        persisted: {},
        initial: {},
      });
      expect(query.state.include.reminderCompleted).toBeUndefined();
      expect(predicates.andIds()).toEqual(['reminders']);
      initialize({
        view: 'calls',
        rememberedTab: undefined,
        entry: {},
        persisted: {},
        initial: {
          query: { include: { documentId: ['call'] } },
          predicates: { and: ['calls'] },
        },
      });
      expect(query.state.include).toEqual({ documentId: ['call'] });
      expect(predicates.andIds()).toEqual(['calls']);
      // The same provider must also migrate an old reminder history entry on return.
      initialize({
        view: 'reminders',
        rememberedTab,
        entry: legacyEntry,
        persisted: {},
        initial: {},
      });
      expect(query.state.include).toEqual({ includeReminders: true });
      expect(predicates.andIds()).toEqual(['reminders']);
      dispose();
    })
);

it('preserves explicit completion refinements on a current all entry', () => {
  const entry = {
    query: { include: { reminderCompleted: true } },
    predicates: { and: ['reminders', 'reminders-done'] },
  };
  expect(
    resolveInitialViewFilters({
      view: 'reminders',
      rememberedTab: 'all',
      entry,
      persisted: {},
      initial: {},
    })
  ).toEqual(entry);
});
