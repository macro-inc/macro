import { type Accessor, mergeProps, splitProps } from 'solid-js';
import { withoutStartDateGrouping, withoutStartDateSort } from '../constants';
import type { TasksViewState } from '../types';

type StartDateSettings = Pick<
  TasksViewState,
  'tab' | 'groupBy' | 'sort' | 'startDate'
>;

/**
 * `state` as a view runs it: once start dates are known to be off, a start
 * grouping, sort or filter from a URL or saved view gives way to the tab's
 * grouping, the Updated sort and no filter, while `state` keeps them.
 */
export function withStartDateFallback<T extends StartDateSettings>(
  state: T,
  off: Accessor<boolean>
) {
  // mergeProps reads through an undefined value to the stored one, so the
  // stored filter is split off for "no filter" to hold.
  const [, rest] = splitProps(state, ['startDate']);
  return mergeProps(rest, {
    get groupBy() {
      return off()
        ? withoutStartDateGrouping(state.groupBy, state.tab)
        : state.groupBy;
    },
    get sort() {
      return off() ? withoutStartDateSort(state.sort) : state.sort;
    },
    get startDate() {
      return off() ? undefined : state.startDate;
    },
  });
}
