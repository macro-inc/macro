import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import {
  createPredicatesStore,
  type PredicateConfig,
} from '../../filters/filter-store/predicates-store';
import { createQueryStore } from '../../filters/filter-store/query-store';
import { toggleReminderCompletionFilter } from './reminder-completion-filter';

it.each([
  [
    'reminders-done',
    'reminders-not-done',
    'reminders-not-done',
    'reminders-done',
    'reminders-done',
  ],
  [
    'reminders-not-done',
    'reminders-done',
    'reminders-done',
    'reminders-not-done',
    'reminders-not-done',
  ],
])(
  'keeps client matches and request completion synchronized through %j',
  (...sequence) =>
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
      for (const [index, id] of sequence.entries()) {
        toggleReminderCompletionFilter(id, predicates, query);
        const expected =
          index === 2 || index === 4 ? undefined : id === 'reminders-done';
        expect(query.state.include.reminderCompleted).toBe(expected);
        expect(query.state.include.includeReminders).toBe(true);
        expect(predicates.test(true, undefined)).toBe(expected !== false);
        expect(predicates.test(false, undefined)).toBe(expected !== true);
        expect(predicates.andIds()).toEqual(
          expected === undefined ? ['reminders'] : ['reminders', id]
        );
        expect(predicates.orIds()).toEqual([]);
      }
      dispose();
    })
);
