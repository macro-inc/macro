import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { openCalendarView } from '@app/features/calendar-view/calendar-navigation';
import { useNavigate } from '@app/lib/split-router';
import { TraceFlow } from '@app/observability/flow';
import { forYouRoute } from '@app/routes/routes';
import { fireAndForget } from '@core/util/fireAndForget';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { createMemo } from 'solid-js';
import { layoutDay } from './core/day';
import { type Suggestion, topPriorities } from './core/suggestion';
import { useSuggestionsSource } from './queries/suggestions-source';
import { SUGGESTION_ITEM_PARTS } from './suggestion-items';
import { HomePrioritiesView } from './views/home-priorities-view';

const PRIORITIES_SHOWN = 5;

/** Today's timed events, when the person has the calendar. */
function useToday() {
  const calendar = useCalendarUiFlag();
  // The day Home was opened on; Home remounts often enough to stay current.
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const range = createCalendarOccurrenceQueryRange(start, end);
  const data = useCalendarOccurrenceData({
    range: () => range,
    queryOptions: () => ({ enabled: calendar() }),
  });

  const today = createMemo(() => {
    if (!calendar() || data.isLoading()) return undefined;

    const events = data
      .visibleEvents()
      .filter((event) => !event.allDay && !event.isCancelled);

    return { date: now, strip: layoutDay(events, now), events };
  });

  return today;
}

function HomePrioritiesContent() {
  const navigate = useNavigate();
  const source = useSuggestionsSource();
  const today = useToday();
  const priorities = createMemo(() =>
    topPriorities(source.suggestions() ?? [], PRIORITIES_SHOWN)
  );
  const openForYou = (suggestion?: Suggestion) =>
    fireAndForget(
      navigate(
        { route: forYouRoute },
        {
          search: suggestion
            ? { forYou: { suggestion: [suggestion.id] } }
            : undefined,
        }
      ),
      'suggestions'
    );

  return (
    <HomePrioritiesView
      today={today()}
      priorities={priorities()}
      parts={SUGGESTION_ITEM_PARTS}
      onOpenEvent={(chip) => {
        const event = today()?.events.find((event) => event.id === chip.id);
        if (!event) return;

        openCalendarView(
          { eventId: event.eventId, occurrenceKey: event.occurrenceKey },
          { referredFrom: 'home' }
        );
      }}
      onOpenSuggestion={openForYou}
      onOpenAll={() => openForYou()}
    />
  );
}

/** Home's Today strip and top priorities, below the composer. */
export function HomePriorities() {
  return (
    <TraceFlow name="suggestions.home">
      <HomePrioritiesContent />
    </TraceFlow>
  );
}
