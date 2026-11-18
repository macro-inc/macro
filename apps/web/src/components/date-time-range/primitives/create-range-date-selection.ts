import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import type { RootRangeProps } from '@corvu/calendar';
import { type Accessor, batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { withLocalDate } from '../time-options';
import {
  type DateTimeRangeValue,
  moveAllDayRange,
  moveTimedRange,
} from '../time-range';

type Selection = NonNullable<RootRangeProps['value']>;
type Endpoint = 'start' | 'end';

/** A two-click date draft; dismissing it never changes the submitted range. */
export function createRangeDateSelection(options: {
  value: Accessor<DateTimeRangeValue>;
  startDisabled: Accessor<boolean>;
  endDisabled: Accessor<boolean>;
  onChange: (value: DateTimeRangeValue) => void;
  moveOnSelect?: boolean;
}) {
  const [state, setState] = createStore<{
    open: boolean;
    endpoint: Endpoint;
    draft: Selection;
    rangeMode: boolean;
  }>({
    open: false,
    endpoint: 'start',
    draft: { from: null, to: null },
    rangeMode: false,
  });
  const dates = () => {
    const value = options.value();
    return {
      from: parseLocalDate(value.start.slice(0, 10)) ?? null,
      to: parseLocalDate(value.end.slice(0, 10)) ?? null,
    };
  };
  const disabled = (endpoint: Endpoint) =>
    endpoint === 'start' ? options.startDisabled() : options.endDisabled();
  const close = () => setState('open', false);
  const open = (endpoint: Endpoint) => {
    if (disabled(endpoint)) return false;
    const current = dates();
    const keepsPendingStart =
      state.open && endpoint === 'end' && state.draft.from && !state.draft.to;
    const draft = keepsPendingStart
      ? state.draft
      : { from: current.from, to: endpoint === 'end' ? null : current.to };
    setState({ open: true, endpoint, draft, rangeMode: !options.moveOnSelect });
    return true;
  };
  const dateIsDisabled = (date: Date) => {
    const current = dates();
    if (options.startDisabled() && current.from && date < current.from)
      return true;
    return Boolean(options.endDisabled() && current.to && date > current.to);
  };
  const change = (next: Selection) => {
    if (!state.open || disabled(state.endpoint)) return;
    if (next.from && dateIsDisabled(next.from)) return;
    if (next.to && dateIsDisabled(next.to)) return;
    if (!state.rangeMode) {
      const selected =
        state.endpoint === 'end' ? (next.to ?? next.from) : next.from;
      if (!selected) return;
      const current = options.value();
      const value = {
        allDay: current.allDay,
        start: current.start,
        end: current.end,
      };
      const date = formatLocalDate(selected);
      const nextValue = { ...value };
      if (state.endpoint === 'end') {
        nextValue.end = value.allDay ? date : withLocalDate(value.end, date);
      } else {
        const start = value.allDay ? date : withLocalDate(value.start, date);
        Object.assign(
          nextValue,
          value.allDay
            ? moveAllDayRange(value, start)
            : moveTimedRange(value, start)
        );
        if (options.endDisabled()) nextValue.end = value.end;
      }
      batch(() => {
        options.onChange(nextValue);
        close();
      });
      return;
    }
    let from = next.from;
    let to = next.to;
    const current = dates();
    if (options.startDisabled()) from = current.from;
    if (options.endDisabled()) to = current.to;
    if (!from || !to) {
      setState({ draft: next, endpoint: from ? 'end' : 'start' });
      return;
    }
    if (to < from) return;
    const value = options.value();
    const start = formatLocalDate(from);
    const end = formatLocalDate(to);
    batch(() => {
      options.onChange({
        allDay: value.allDay,
        start: value.allDay ? start : withLocalDate(value.start, start),
        end: value.allDay ? end : withLocalDate(value.end, end),
      });
      close();
    });
  };
  return {
    state,
    open,
    close,
    change,
    dateIsDisabled,
    beginRange: () => setState('rangeMode', true),
  };
}
