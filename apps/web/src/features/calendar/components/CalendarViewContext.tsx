import { useCalendarFocus } from '@app/features/calendar-view/calendar-focus-target';
import { beginInteraction } from '@app/observability/flow';
import { createAssertedContextProvider } from '@core/context/createContext';
import {
  createdCalendarEventId,
  createdCalendarOccurrences,
  isCalendarEventCreating,
} from '@queries/calendar/graphql/mutations';
import { subscribeToTeamCalendarReset } from '@queries/calendar/team-cache';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { useCalendarSources } from '../hooks/use-calendar-sources';
import {
  type CalendarEvent,
  type CalendarPeriodView,
  type CalendarTimeFormat,
  type CalendarWeekStart,
  isCalendarEventVisible,
  mapCalendarOccurrence,
} from '../types';
import { useCalendarPreferences } from '../utils/preferences';

interface CalendarDisplaySettings {
  readonly periodView: CalendarPeriodView;
  readonly showWeekends: boolean;
  readonly weekStartsOn: CalendarWeekStart;
  readonly timeFormat: CalendarTimeFormat;
}

type CalendarViewContextProps = ParentProps<{
  periodView?: CalendarPeriodView;
  focusedEventId?: string;
  onPeriodViewChange?: (periodView: CalendarPeriodView) => void;
  onFocusedEventIdChange?: (eventId: string | undefined) => void;
}>;

export function createCalendarEventSelection(
  onFocusedEventIdChange?: (eventId: string | undefined) => void
) {
  const [event, setEvent] = createSignal<CalendarEvent>();
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [origin, setOrigin] = createSignal<'grid' | 'agenda'>('grid');

  const close = (notify = true) => {
    const hadSelection = event() !== undefined || anchor() !== undefined;
    batch(() => {
      setEvent(undefined);
      setAnchor(undefined);
    });
    if (notify && hadSelection) onFocusedEventIdChange?.(undefined);
  };
  const select = (
    nextEvent: CalendarEvent,
    nextAnchor: HTMLElement,
    nextOrigin: 'grid' | 'agenda' = 'grid'
  ) => {
    batch(() => {
      setEvent(() => nextEvent);
      setAnchor(nextAnchor);
      setOrigin(nextOrigin);
    });
    // Opaque team projections have no direct-event navigation capability,
    // and a local id the server never issued names no event to navigate to;
    // a created event is reported once it lands.
    onFocusedEventIdChange?.(
      nextEvent.teamProjection || isCalendarEventCreating(nextEvent.eventId)
        ? undefined
        : serverEventId(nextEvent.eventId)
    );
  };
  const refresh = (nextEvent: CalendarEvent) => {
    if (event()?.id === nextEvent.id) setEvent(nextEvent);
  };
  /** Moves the selection from a created event's local id to its server id. */
  const land = (nextEvent: CalendarEvent, nextChip?: HTMLElement) => {
    batch(() => {
      setEvent(() => nextEvent);
      // A list selection stays on its row, as in `reanchor`.
      if (nextChip && origin() === 'grid') setAnchor(nextChip);
    });
    onFocusedEventIdChange?.(nextEvent.eventId);
  };
  // A grid selection follows its chip when the grid replaces it. A list
  // selection stays on its row, so a chip mounting late never moves it.
  const reanchor = (nextEvent: CalendarEvent, nextAnchor: HTMLElement) => {
    if (origin() !== 'grid') return;
    // The grid can still draw a landed create's local copy for the server's
    // copy the details already show.
    if (createdCalendarEventId(nextEvent.eventId) === event()?.eventId)
      setAnchor(nextAnchor);
    else select(nextEvent, nextAnchor);
  };

  return { anchor, close, event, land, origin, reanchor, refresh, select };
}

/** The id the server issued for `eventId`, a created event's local id or its own. */
function serverEventId(eventId: string): string {
  return createdCalendarEventId(eventId) ?? eventId;
}

/** The one of `events` that stands for `selected`'s occurrence. */
function sameOccurrence(
  selected: CalendarEvent,
  events: readonly CalendarEvent[]
): CalendarEvent | undefined {
  return (
    events.find((event) => event.occurrenceKey === selected.occurrenceKey) ??
    (events.length === 1 ? events[0] : undefined)
  );
}

/**
 * The event a selected create became once it landed under the server's id:
 * the page's copy, or until the page's reads catch up, the server's copy from
 * the create's own answer.
 */
function landedEvent(
  selected: CalendarEvent,
  eventsById: ReadonlyMap<string, CalendarEvent>,
  answered: (localId: string) => CalendarEvent[]
): CalendarEvent | undefined {
  const serverId = createdCalendarEventId(selected.eventId);
  if (!serverId) return undefined;
  return (
    sameOccurrence(
      selected,
      [...eventsById.values()].filter((event) => event.eventId === serverId)
    ) ?? sameOccurrence(selected, answered(selected.eventId))
  );
}

/**
 * The page's event for the selection: its own, or the local copy of a
 * landed create whose details already show the server's.
 */
export function selectionOnPage(
  selected: CalendarEvent,
  eventsById: ReadonlyMap<string, CalendarEvent>
): CalendarEvent | undefined {
  return (
    eventsById.get(selected.id) ??
    sameOccurrence(
      selected,
      [...eventsById.values()].filter(
        (event) => createdCalendarEventId(event.eventId) === selected.eventId
      )
    )
  );
}

export const [CalendarViewContextProvider, useCalendarView] =
  createAssertedContextProvider(
    'CalendarViewContext',
    (props: CalendarViewContextProps) => {
      const [preferences, setPreferences] = useCalendarPreferences();
      const { sources, sourceById, sourcesReady } = useCalendarSources();
      // Sources default to visible, so calendars discovered after a
      // preference was saved (or events whose calendar is still loading)
      // never silently disappear.
      const hiddenSourceIds = createMemo<ReadonlySet<string>>(
        () => new Set(preferences.hiddenSourceIds)
      );
      const isSourceVisible = (sourceId: string) =>
        !hiddenSourceIds().has(sourceId);

      const selection = createCalendarEventSelection(
        props.onFocusedEventIdChange
      );
      const calendarFocus = useCalendarFocus();
      // A selection made while a row waits for its chip wins over that row.
      const selectEvent: typeof selection.select = (...args) => {
        // Ends one paint after the details open; a flow they mount joins it.
        const interaction = beginInteraction('calendar.event.open', {
          attributes: { 'calendar.event.origin': args[2] ?? 'grid' },
        });
        try {
          calendarFocus.cancelOccurrence();
          selection.select(...args);
        } finally {
          interaction.end();
        }
      };
      // A revoked OOO agenda entry can lie outside every mounted viewport.
      // Close detached selections synchronously when authorization resets data.
      const unsubscribeTeamReset = subscribeToTeamCalendarReset(() => {
        calendarFocus.cancelOccurrence();
        const selected = selection.event();
        if (
          selected?.teamProjection ||
          selected?.calendar.id.startsWith('team-ooo:')
        )
          selection.close();
      });
      onCleanup(unsubscribeTeamReset);
      // Preferences are shared across providers; track only this route's period
      // so two mounted calendars never overwrite each other in a loop.
      createEffect(
        on(
          () => props.periodView,
          (periodView) => {
            if (periodView) setPreferences('periodView', periodView);
          }
        )
      );
      createEffect(
        on(
          () => props.focusedEventId,
          (focusedEventId, previousEventId) => {
            const selectedEvent = selection.event();
            if (
              previousEventId !== undefined &&
              focusedEventId !== previousEventId &&
              selectedEvent &&
              !selectedEvent.teamProjection &&
              !isCalendarEventCreating(selectedEvent.eventId) &&
              serverEventId(selectedEvent.eventId) !== focusedEventId
            ) {
              selection.close(false);
            }
          }
        )
      );
      const displaySettings: CalendarDisplaySettings = {
        get periodView() {
          return props.periodView ?? preferences.periodView;
        },
        get showWeekends() {
          return preferences.showWeekends;
        },
        get weekStartsOn() {
          return preferences.weekStartsOn;
        },
        get timeFormat() {
          return preferences.timeFormat;
        },
      };

      const closeEventDetails = () => selection.close();
      const answeredEvents = (localId: string) =>
        createdCalendarOccurrences(localId).map((item) =>
          mapCalendarOccurrence(item, {
            sourceById: sourceById(),
            isSourceVisible,
          })
        );

      const refreshSelectedEventFromPage = (
        eventsById: ReadonlyMap<string, CalendarEvent>,
        rangeIsCurrent: boolean,
        chipFor?: (id: string) => HTMLElement | undefined
      ) => {
        const selected = selection.event();
        if (!selected) return;
        const landed = landedEvent(selected, eventsById, answeredEvents);
        const event = landed ? undefined : eventsById.get(selected.id);
        if (landed) {
          if (isCalendarEventVisible(landed, isSourceVisible))
            selection.land(landed, chipFor?.(landed.id));
          else closeEventDetails();
        } else if (event) {
          if (isCalendarEventVisible(event, isSourceVisible))
            selection.refresh(event);
          else closeEventDetails();
        } else if (
          isCalendarEventCreating(selected.eventId) ||
          selectionOnPage(selected, eventsById)
        ) {
          // The server's copy replaces a created event's local one; its
          // details stay open until the server's id is known, and then
          // until the page draws the server's copy.
          return;
        } else if (
          (rangeIsCurrent || selected.teamProjection) &&
          selection.origin() === 'grid'
        ) {
          // Agenda selections can be outside the visible grid's date range.
          closeEventDetails();
        }
      };

      const setSourcesVisibility = (
        sourceIds: readonly string[],
        visible: boolean
      ) => {
        const hidden = new Set(preferences.hiddenSourceIds);
        let changed = false;
        for (const sourceId of sourceIds) {
          if (visible) changed = hidden.delete(sourceId) || changed;
          else if (!hidden.has(sourceId)) {
            hidden.add(sourceId);
            changed = true;
          }
        }
        if (!changed) return;
        setPreferences('hiddenSourceIds', [...hidden]);

        const selected = selection.event();
        if (
          !visible &&
          selected &&
          !isCalendarEventVisible(selected, isSourceVisible)
        ) {
          closeEventDetails();
        }
      };
      const setSourceVisibility = (sourceId: string, visible: boolean) =>
        setSourcesVisibility([sourceId], visible);

      return {
        displaySettings,
        sources,
        sourceById,
        sourcesReady,
        hiddenSourceIds,
        isSourceVisible,
        setSourceVisibility,
        setSourcesVisibility,
        selectedEvent: selection.event,
        selectedEventAnchor: selection.anchor,
        setPeriodView: (periodView: CalendarPeriodView) => {
          setPreferences('periodView', periodView);
          props.onPeriodViewChange?.(periodView);
        },
        setShowWeekends: (showWeekends: boolean) =>
          setPreferences('showWeekends', showWeekends),
        setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
          setPreferences('weekStartsOn', weekStartsOn),
        setTimeFormat: (timeFormat: CalendarTimeFormat) =>
          setPreferences('timeFormat', timeFormat),
        closeEventDetails,
        selectEvent,
        reanchorSelectedEvent: selection.reanchor,
        refreshSelectedEvent: selection.refresh,
        refreshSelectedEventFromPage,
      };
    }
  );
