/** The immutable details reviewed before cancellation and reinvitation. */
export type EventReplacementPreview = {
  operationId: string;
  status: 'needs_confirmation' | 'in_progress' | 'complete';
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  attendeeCount: number;
  isSeries: boolean;
  removeConference: boolean;
  providerUrl?: string;
  replacementUrl?: string;
  completedSteps: number;
  totalSteps: number;
};
export type EventReplacementTarget = {
  eventId: string;
  calendarId?: string;
  recurrenceId?: string;
};
