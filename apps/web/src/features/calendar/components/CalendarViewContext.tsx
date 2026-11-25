import { useCalendarFocus } from '@app/features/calendar-view/calendar-focus-target';
import { beginInteraction } from '@app/observability/flow';
import { createAssertedContextProvider } from '@core/context/createContext';
import {
  type CalendarOccurrenceMove,
  type CalendarOccurrenceRef,
  createdCalendarEventId,
  createdCalendarOccurrence,
  isCalendarEventCreating,
  isCalendarOccurrenceMoving,
  onCalendarOccurrenceMoved,
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

/**
 * Reports the event the open details name. A selection that lands on what
 * replaced it also names the occurrence it landed on, which a moved event
 * changes: a link's locator for the one it replaced no longer leads to it.
 */
type FocusedEventIdChange = (
  eventId: string | undefined,
  landedOccurrenceKey?: string
) => void;

type CalendarViewContextProps = ParentProps<{
  periodView?: CalendarPeriodView;
  focusedEventId?: string;
  onPeriodViewChange?: (periodView: CalendarPeriodView) => void;
  onFocusedEventIdChange?: FocusedEventIdChange;
}>;

export function createCalendarEventSelection(
  onFocusedEventIdChange?: FocusedEventIdChange
) {
  const [event, setEvent] = createSignal<CalendarEvent>();
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [origin, setOrigin] = createSignal<'grid' | 'agenda'>('grid');
  // The occurrence a move answered while these details were open put in
  // place of the selected one. It belongs to this selection alone, so a
  // later selection never follows an older move.
  const [following, setFollowing] = createSignal<CalendarOccurrenceRef>();

  const close = (notify = true) => {
    const hadSelection = event() !== undefined || anchor() !== undefined;
    batch(() => {
      setEvent(undefined);
      setAnchor(undefined);
      setFollowing(undefined);
    });
    if (notify && hadSelection) onFocusedEventIdChange?.(undefined);
  };
  const show = (
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
  const select: typeof show = (...args) => {
    setFollowing(undefined);
    show(...args);
  };
  const refresh = (nextEvent: CalendarEvent) => {
    if (event()?.id === nextEvent.id) setEvent(nextEvent);
  };
  /**
   * Follows a move of the selected occurrence once the page draws its
   * replacement, and a later move of that replacement before then.
   */
  const follow = (move: CalendarOccurrenceMove) => {
    const startsHere = (ref: CalendarOccurrenceRef | undefined) =>
      ref?.eventId === move.from.eventId &&
      ref.occurrenceKey === move.from.occurrenceKey;
    if (startsHere(event()) || startsHere(following())) setFollowing(move.to);
  };
  /**
   * Moves the selection to what replaced it: a created event's server copy,
   * or the occurrence a move put in place of the selected one.
   */
  const land = (nextEvent: CalendarEvent, nextChip?: HTMLElement) => {
    batch(() => {
      setEvent(() => nextEvent);
      setFollowing(undefined);
      // A list selection stays on its row, as in `reanchor`.
      if (nextChip && origin() === 'grid') setAnchor(nextChip);
    });
    onFocusedEventIdChange?.(nextEvent.eventId, nextEvent.occurrenceKey);
  };
  // A grid selection follows its chip when the grid replaces it. A list
  // selection stays on its row, so a chip mounting late never moves it. The
  // chip is the selected occurrence's, so a move it follows still holds.
  const reanchor = (nextEvent: CalendarEvent, nextAnchor: HTMLElement) => {
    if (origin() !== 'grid') return;
    const current = event();
    // The grid can still draw a landed create's local copy for the server's
    // copy the details already show.
    if (
      current &&
      createdCalendarEventId(nextEvent.eventId) === current.eventId
    )
      setAnchor(nextAnchor);
    else show(nextEvent, nextAnchor);
  };

  return {
    anchor,
    close,
    event,
    follow,
    following,
    land,
    origin,
    reanchor,
    refresh,
    select,
  };
}

/** The id the server issued for `eventId`, a created event's local id or its own. */
function serverEventId(eventId: string): string {
  return createdCalendarEventId(eventId) ?? eventId;
}

type OccurrenceRef = Pick<CalendarEvent, 'id' | 'eventId' | 'occurrenceKey'>;

/** The one of `events` that stands for `selected`'s occurrence. */
function sameOccurrence<Shown extends OccurrenceRef>(
  selected: OccurrenceRef,
  events: readonly Shown[]
): Shown | undefined {
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
  answered: (localId: string) => CalendarEvent | undefined
): CalendarEvent | undefined {
  const serverId = createdCalendarEventId(selected.eventId);
  if (!serverId) return undefined;
  const onPage = [...eventsById.values()].filter(
    (event) => event.eventId === serverId
  );
  // The answer's copy is this occurrence, so it beats a lone page occurrence
  // of the same event on another date.
  return (
    onPage.find((event) => event.occurrenceKey === selected.occurrenceKey) ??
    answered(selected.eventId) ??
    sameOccurrence(selected, onPage)
  );
}

/**
 * The page's copy of the occurrence the selection follows a move to. Until
 * the page draws it, the selection stays on what the page draws.
 */
function followedEvent(
  following: CalendarOccurrenceRef | undefined,
  eventsById: ReadonlyMap<string, CalendarEvent>
): CalendarEvent | undefined {
  if (!following) return undefined;
  return [...eventsById.values()].find(
    (event) =>
      event.eventId === following.eventId &&
      event.occurrenceKey === following.occurrenceKey
  );
}

/**
 * The shown item for the selection, by id: its own, or the local copy of a
 * landed create whose details already show the server's.
 */
export function selectionOnPage<Shown extends OccurrenceRef>(
  selected: OccurrenceRef,
  eventsById: ReadonlyMap<string, Shown>
): Shown | undefined {
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
      onCleanup(
        onCalendarOccurrenceMoved((move) => {
          if (move) selection.follow(move);
        })
      );
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
      const answeredEvent = (localId: string) => {
        const item = createdCalendarOccurrence(localId);
        return (
          item &&
          mapCalendarOccurrence(item, {
            sourceById: sourceById(),
            isSourceVisible,
          })
        );
      };

      const refreshSelectedEventFromPage = (
        eventsById: ReadonlyMap<string, CalendarEvent>,
        rangeIsCurrent: boolean,
        chipFor?: (id: string) => HTMLElement | undefined
      ) => {
        const selected = selection.event();
        if (!selected) return;
        const landed =
          landedEvent(selected, eventsById, answeredEvent) ??
          followedEvent(selection.following(), eventsById);
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
          isCalendarOccurrenceMoving(
            selected.eventId,
            selected.occurrenceKey
          ) ||
          selectionOnPage(selected, eventsById)
        ) {
          // The server's copy replaces a created event's local one; its
          // details stay open until the server's id is known, and then
          // until the page draws the server's copy. A moved occurrence's
          // stay open until the move's answer names what replaced it.
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
