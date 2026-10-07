import { useCalendarSources } from '@app/features/calendar/hooks/use-calendar-sources';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { nextMeetingBadge } from '@app/features/meetings/core/next-meeting-badge';
import { createCallSidebarClock } from '@app/features/meetings/primitives/call-sidebar';
import { useUpcomingCalendarEventsSource } from '@app/features/meetings/queries/upcoming-calendar-events';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';

/**
 * The Calendar button's badge: `Now` during a meeting, minutes until the next
 * one when it is under an hour away. Reads the same visible calendars and
 * upcoming-events source as the calendar view's agenda, so a calendar hidden
 * there never counts here. Mount it only where Calendar is on the rail — it
 * starts fetching on mount.
 */
export function useNextMeetingBadge() {
  const userId = useUserId();
  const now = createCallSidebarClock();
  const { sourceById } = useCalendarSources();
  const [preferences] = useCalendarPreferences();
  const hiddenSourceIds = createMemo(
    () => new Set(preferences.hiddenSourceIds)
  );
  const upcoming = useUpcomingCalendarEventsSource({
    userId,
    sourceById,
    isSourceVisible: (sourceId) => !hiddenSourceIds().has(sourceId),
    now,
  });
  return createMemo(() => nextMeetingBadge(upcoming.events(), now()));
}
