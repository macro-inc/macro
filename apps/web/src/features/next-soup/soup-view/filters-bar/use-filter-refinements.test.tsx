import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import {
  createPredicatesStore,
  type PredicateConfig,
} from '../../filters/filter-store/predicates-store';
import { createQueryStore } from '../../filters/filter-store/query-store';
import { toggleReminderCompletionFilter } from './reminder-completion-filter';
import { useFilterRefinements } from './use-filter-refinements';

const state = vi.hoisted(() => ({
  current: {} as {
    soup: {
      predicates: ReturnType<
        typeof createPredicatesStore<boolean, unknown, PredicateConfig<boolean>>
      >;
    };
    queryFilters: ReturnType<typeof createQueryStore>;
    items: () => never[];
    assigneeFilter: () => never[];
    setAssigneeFilter: ReturnType<typeof vi.fn>;
    activeTab: () => string;
  },
}));
vi.mock('../soup-view-context', () => ({ useSoupView: () => state.current }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'component', id: 'reminders' }) },
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserContext: () => ({ userId: () => 'user' }),
  useUserId: () => () => 'user',
}));
vi.mock('@queries/contacts/contacts', () => ({ useContacts: () => () => [] }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@app/features/next-soup/filters', () => ({ NO_ASSIGNEE: 'none' }));
vi.mock('./tag-filter', () => ({
  useTagFilter: () => ({ hasTags: () => false }),
}));
vi.mock('../../sidebar/soup-filter-presets', () => ({
  getViewPreset: () => ({
    filters: { include: { includeReminders: true } },
    clientFilters: { and: ['reminders'] },
  }),
  VIEW_TAB_PRESETS: { reminders: { default: 'all' } },
}));
vi.mock('./unified-filter-dropdown', () => ({
  buildContactLabel: () => '',
  VIEW_FILTER_CATEGORIES: {
    reminders: [
      {
        id: 'completion',
        label: 'Completion',
        multiple: false,
        options: [
          { id: 'reminders-done', label: 'Done' },
          { id: 'reminders-not-done', label: 'Not done' },
        ],
      },
    ],
  },
}));

it.each([true, false])(
  'keeps completion chips and collection requests synchronized starting at %s',
  (initial) => {
    createRoot((dispose) => {
      const query = createQueryStore({
        initial: { include: { includeReminders: true } },
      });
      const predicates = createPredicatesStore<
        boolean,
        unknown,
        PredicateConfig<boolean>
      >({
        configs: [
          { id: 'reminders', predicate: () => true },
          { id: 'reminders-done', predicate: (done: boolean) => done },
          { id: 'reminders-not-done', predicate: (done: boolean) => !done },
        ],
        initial: { and: ['reminders'] },
      });
      state.current = {
        soup: { predicates },
        queryFilters: query,
        items: () => [],
        assigneeFilter: () => [],
        setAssigneeFilter: vi.fn(),
        activeTab: () => 'all',
      };
      const refinements = useFilterRefinements();
      const id = (done: boolean) =>
        done ? 'reminders-done' : 'reminders-not-done';
      const check = (completed: boolean | undefined) => {
        expect(query.state.include).toEqual({
          includeReminders: true,
          reminderCompleted: completed,
        });
        expect(predicates.test(true, undefined)).toBe(completed !== false);
        expect(predicates.test(false, undefined)).toBe(completed !== true);
        expect(
          refinements
            .consolidatedFiltersList()
            .flatMap((chip) => chip.values().map((value) => value.id))
        ).toEqual(completed === undefined ? [] : [id(completed)]);
      };
      toggleReminderCompletionFilter(id(initial), predicates, query);
      check(initial);
      const chip = refinements.consolidatedFiltersList()[0];
      expect(chip.multiple).toBe(false);
      chip.onToggleValue!(id(!initial));
      check(!initial);
      chip.onToggleValue!(id(!initial));
      check(undefined);
      toggleReminderCompletionFilter(id(initial), predicates, query);
      refinements.consolidatedFiltersList()[0].onRemoveAll();
      check(undefined);
      toggleReminderCompletionFilter(id(initial), predicates, query);
      refinements.resetToTabDefaults();
      check(undefined);
      dispose();
    });
  }
);
