import { type Span, Telemetry } from '@macro-inc/observability';
import type { UpdateCalendarEventArgs } from '@queries/calendar/mutations';
import type { EventTime } from '@service-calendar/generated/schemas/eventTime';
import type { CalendarUpdateScope } from '@service-email/client';
import { type Accessor, onCleanup } from 'solid-js';
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

/** Owns the grid preview until scope selection hands it to the shared cache. */
export function createEventTimeChange(options: {
  active: Accessor<boolean>;
  save: (args: UpdateCalendarEventArgs) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [state, setState] = createStore<{
    phase: 'idle' | 'choosing' | 'installing';
    scope: CalendarUpdateScope;
    change?: PendingTimeChange;
  }>({ phase: 'idle', scope: 'this_event' });
  let disposed = false;

  function release(change: PendingTimeChange) {
    if (!disposed && state.change === change) {
      setState({ phase: 'idle', change: undefined });
    }
  }

  function finish(
    change: PendingTimeChange,
    outcome: 'success' | 'cancelled' | 'error'
  ) {
    change.span.setAttr('calendar.time_change.outcome', outcome);
    change.span.end();
    release(change);
  }

  function cancel() {
    const change = state.change;
    if (!change || state.phase !== 'choosing') return;
    change.revert();
    finish(change, 'cancelled');
  }

  async function confirm() {
    const change = state.change;
    if (!change || state.phase !== 'choosing') return;
    if (!options.active()) {
      cancel();
      return;
    }
    const scope = state.scope;
    setState('phase', 'installing');
    change.span.setAttr('calendar.update.scope', scope);
    let installed = false;
    try {
      const args = calendarEventTimeUpdate(change.event, change.time, scope);
      await options.save({
        ...args,
        parentSpan: change.span,
        onOptimistic: () => {
          installed = true;
          release(change);
        },
      });
      finish(change, 'success');
    } catch (error) {
      // Once installed, the shared cache rolls back just this write. An old
      // FullCalendar revert would also undo a newer drag on the same event.
      if (!installed && !disposed) change.revert();
      change.span.error('Calendar time change failed');
      finish(change, 'error');
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

  onCleanup(() => {
    cancel();
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
