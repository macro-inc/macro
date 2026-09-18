export type CalendarHomeTab = 'events' | 'calls';
export type CalendarEventFilter = 'all' | 'my';

export interface FilterableCalendarEvent {
  attendees: readonly {
    email: string;
    isSelf: boolean;
    isOrganizer: boolean;
    responseStatus: string;
  }[];
  organizerEmail?: string;
  creatorEmail?: string;
}

/** "My events" includes events the viewer owns or plans to attend. */
export function matchesCalendarEventFilter(
  event: FilterableCalendarEvent,
  filter: CalendarEventFilter,
  viewerEmail?: string
): boolean {
  if (filter === 'all') return true;

  const normalizedViewerEmail = viewerEmail?.toLowerCase();
  const createdByViewer = normalizedViewerEmail
    ? event.creatorEmail?.toLowerCase() === normalizedViewerEmail ||
      event.organizerEmail?.toLowerCase() === normalizedViewerEmail
    : false;

  return (
    createdByViewer ||
    event.attendees.some(
      (attendee) =>
        attendee.isSelf &&
        (attendee.isOrganizer ||
          attendee.responseStatus === 'accepted' ||
          attendee.responseStatus === 'tentative')
    )
  );
}
