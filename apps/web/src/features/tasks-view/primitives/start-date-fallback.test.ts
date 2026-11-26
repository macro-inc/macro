import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, it } from 'vitest';
import { TASK_DEFAULT_GROUP_BY } from '../constants';
import type { TasksViewState } from '../types';
import { withStartDateFallback } from './start-date-fallback';

function setup(stored: Partial<TasksViewState>) {
  return createRoot(() => {
    const [state] = createStore<TasksViewState>({
      layout: 'list',
      tab: 'team-tasks',
      search: '',
      groupBy: 'start_date',
      sort: [{ id: 'start_date_earliest' }],
      facets: {},
      startDate: { type: 'next_7_days' },
      collapsedGroupIds: [],
      collapsedSidebarSectionIds: [],
      ...stored,
    });
    const [off, setOff] = createSignal(false);
    return { state, view: withStartDateFallback(state, off), setOff };
  });
}

it('keeps start-date settings while start dates are on or still loading', () => {
  const { view } = setup({});
  expect(view.groupBy).toBe('start_date');
  expect(view.sort).toEqual([{ id: 'start_date_earliest' }]);
  expect(view.startDate).toEqual({ type: 'next_7_days' });
});

it('runs a stored start grouping, sort and filter as defaults once start dates are off, keeping the stored ones', () => {
  const { state, view, setOff } = setup({});
  setOff(true);
  expect(view.groupBy).toBe(TASK_DEFAULT_GROUP_BY['team-tasks']);
  expect(view.sort).toEqual([{ id: 'updated_at' }]);
  expect(view.startDate).toBeUndefined();
  expect(state.groupBy).toBe('start_date');
  expect(state.startDate).toEqual({ type: 'next_7_days' });
  setOff(false);
  expect(view.startDate).toEqual({ type: 'next_7_days' });
});

it('leaves other settings alone with start dates off', () => {
  const { view, setOff } = setup({
    groupBy: 'due_date',
    sort: [{ id: 'due_date_latest' }],
    startDate: undefined,
    dueDate: { type: 'overdue' },
  });
  setOff(true);
  expect(view.groupBy).toBe('due_date');
  expect(view.sort).toEqual([{ id: 'due_date_latest' }]);
  expect(view.dueDate).toEqual({ type: 'overdue' });
  expect(view.tab).toBe('team-tasks');
});
