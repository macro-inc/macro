import { type Span, Telemetry } from '@macro-inc/observability';
import type { UpdateCalendarEventArgs } from '@queries/calendar/mutations';
import type { EventTime } from '@service-calendar/generated/schemas/eventTime';
import type { CalendarUpdateScope } from '@service-email/client';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CalendarEvent } from '../types';
import {
  type CalendarEventTimeChange,
  calendarEventTimeFromFullCalendar,
  canEditCalendarEventTime,
  isRecurringCalendarEvent,
} from '../utils/event-interaction';
import { calendarEventTimeUpdate } from '../utils/event-time-update';

interface PendingTimeChange {
  event: CalendarEvent;
  time: EventTime;
  revert: () => void;
  span: Span;
}

/** Owns the grid's optimistic move until scope selection and persistence settle. */
export function createEventTimeChange(options: {
  active: Accessor<boolean>;
  save: (args: UpdateCalendarEventArgs) => Promise<unknown>;
  onError: (error: unknown) => void;
  refreshStatus?: Accessor<{ started: number; completed: number }>;
}) {
  const [state, setState] = createStore<{
    phase: 'idle' | 'choosing' | 'saving' | 'refreshing';
    scope: CalendarUpdateScope;
    refreshStarted: number;
    change?: PendingTimeChange;
  }>({ phase: 'idle', scope: 'this_event', refreshStarted: 0 });
  let disposed = false;

  function finish(outcome: 'success' | 'cancelled' | 'error') {
    const change = state.change;
    if (!change) return;
    if (!disposed && outcome !== 'success') change.revert();
    change.span.setAttr('calendar.update.scope', state.scope);
    change.span.setAttr('calendar.time_change.outcome', outcome);
    change.span.end();
    setState({ phase: 'idle', change: undefined });
  }

  function cancel() {
    if (state.phase === 'choosing') finish('cancelled');
  }

  async function confirm() {
    const change = state.change;
    if (!change || state.phase !== 'choosing') return;
    if (!options.active()) {
      finish('cancelled');
      return;
    }
    const scope = state.scope;
    setState('phase', 'saving');
    change.span.setAttr('calendar.update.scope', scope);
    let writeAccepted = false;
    try {
      const args = calendarEventTimeUpdate(change.event, change.time, scope);
      await options.save({
        ...args,
        parentSpan: change.span,
        onWriteAccepted: () => {
          writeAccepted = true;
          if (disposed) {
            finish('success');
          } else if (options.refreshStatus) {
            setState({
              phase: 'refreshing',
              refreshStarted: options.refreshStatus().started,
            });
          }
        },
      });
      if (!options.refreshStatus) finish('success');
    } catch (error) {
      if (writeAccepted) {
        change.span.error('Calendar refresh failed after saving');
        return;
      }
      change.span.error('Calendar time change failed');
      finish('error');
      if (!disposed) options.onError(error);
    }
  }

  async function handle(
    change: CalendarEventTimeChange,
    event?: CalendarEvent
  ) {
    if (
      !options.active() ||
      state.phase !== 'idle' ||
      !event ||
      !canEditCalendarEventTime(event)
    ) {
      change.revert();
      return;
    }
    const time = calendarEventTimeFromFullCalendar(change.event, event);
    if (!time) {
      change.revert();
      return;
    }
    const span = Telemetry.span('calendar.event_time_change');
    span.setAttr('calendar.event_id', event.eventId);
    span.setAttr('calendar.calendar_id', event.calendarId ?? event.calendar.id);
    span.setAttr('calendar.time_change.kind', change.kind ?? 'move');
    span.setAttr('calendar.update.scope', 'unselected');
    setState({
      phase: 'choosing',
      scope: 'this_event',
      change: { event, time, revert: change.revert, span },
    });
    if (!isRecurringCalendarEvent(event)) {
      setState('scope', 'all');
      await confirm();
    }
  }

  // Release the imperative grid preview only for a successful read that began
  // after acceptance. A skipped refresh, failed read, or optimistic write is
  // not proof that the occurrence data has caught up.
  createEffect(
    on(
      () => options.refreshStatus?.().completed,
      (completed) => {
        if (
          state.phase === 'refreshing' &&
          completed !== undefined &&
          completed > state.refreshStarted
        ) {
          finish('success');
        }
      }
    )
  );

  onCleanup(() => {
    if (state.phase === 'choosing') finish('cancelled');
    if (state.phase === 'refreshing') finish('success');
    disposed = true;
  });

  const allEventsUnavailableReason = () => {
    const change = state.change;
    if (!change) return undefined;
    try {
      calendarEventTimeUpdate(change.event, change.time, 'all');
      return undefined;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Only this event can be changed.';
    }
  };

  return {
    allEventsUnavailableReason,
    pending: () => state.phase !== 'idle',
    choosing: () => state.phase === 'choosing',
    scope: () => state.scope,
    setScope: (scope: CalendarUpdateScope) => setState('scope', scope),
    cancel,
    confirm,
    handle,
  };
}
