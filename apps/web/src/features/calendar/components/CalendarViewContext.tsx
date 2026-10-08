import { createAssertedContextProvider } from '@core/context/createContext';
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
} from '../types';
import { useCalendarPreferences } from '../utils/preferences';

interface CalendarDisplaySettings {
  readonly periodView: CalendarPeriodView;
  readonly showWeekends: boolean;
  readonly weekStartsOn: CalendarWeekStart;
  readonly timeFormat: CalendarTimeFormat;
  readonly showTeamCalendars: boolean;
}

type CalendarViewContextProps = ParentProps<{
  periodView?: CalendarPeriodView;
  focusedEventId?: string;
  onPeriodViewChange?: (periodView: CalendarPeriodView) => void;
  onFocusedEventIdChange?: (eventId: string | undefined) => void;
}>;

function createCalendarEventSelection(
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
    // Opaque team projections have no direct-event navigation capability.
    onFocusedEventIdChange?.(
      nextEvent.teamProjection ? undefined : nextEvent.eventId
    );
  };
  const refresh = (nextEvent: CalendarEvent) => {
    if (event()?.id === nextEvent.id) setEvent(nextEvent);
  };

  return { anchor, close, event, origin, refresh, select };
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
      // A revoked OOO agenda entry can lie outside every mounted viewport.
      // Close detached selections synchronously when authorization resets data.
      const unsubscribeTeamReset = subscribeToTeamCalendarReset(() => {
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
              selectedEvent.eventId !== focusedEventId
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
        get showTeamCalendars() {
          return preferences.showTeamCalendars;
        },
      };

      const closeEventDetails = () => selection.close();

      const refreshSelectedEventFromPage = (
        eventsById: ReadonlyMap<string, CalendarEvent>,
        rangeIsCurrent: boolean
      ) => {
        const selected = selection.event();
        if (!selected) return;
        const event = eventsById.get(selected.id);
        if (event) {
          if (isCalendarEventVisible(event, isSourceVisible))
            selection.refresh(event);
          else closeEventDetails();
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
        setShowTeamCalendars: (visible: boolean) => {
          setPreferences('showTeamCalendars', visible);
          if (!visible && selection.event()?.teamProjection)
            closeEventDetails();
        },
        closeEventDetails,
        selectEvent: selection.select,
        refreshSelectedEvent: selection.refresh,
        refreshSelectedEventFromPage,
      };
    }
  );
