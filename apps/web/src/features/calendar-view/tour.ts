import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const CALENDAR_TOUR = defineTourTargets('calendar', [
  'sources',
  'availability',
  'period',
  'grid',
  'sidebarToggle',
]);

export const calendarTour = defineViewTour({
  id: 'calendar',
  title: 'Calendar',
  connector: { kind: 'email', label: 'Google' },
  steps: [
    {
      target: CALENDAR_TOUR.sources,
      entry: CALENDAR_TOUR.sidebarToggle,
      entryLabel: 'Open the calendar sidebar to continue the tour',
      missingHint:
        'Connect your calendars, then open the calendar sidebar to choose which ones to show.',
      title: 'All your calendars, one schedule',
      description:
        'Connect multiple Google accounts and see work, personal, and shared calendars together. Expand an account here to toggle individual calendars.',
    },
    {
      target: CALENDAR_TOUR.availability,
      entry: CALENDAR_TOUR.sidebarToggle,
      entryLabel: 'Open the calendar sidebar to continue the tour',
      missingHint: 'Connect a Google calendar to enable availability copying.',
      title: 'Copy your availability',
      description:
        'Choose a date range to copy your open times, then paste them into a message or email. Busy events across your connected calendars are taken into account.',
    },
    {
      target: CALENDAR_TOUR.period,
      title: 'Choose how you see your week',
      description:
        'Switch between day, week, and month. Move through dates without losing your connected calendars.',
    },
    {
      target: CALENDAR_TOUR.grid,
      title: 'Keep the conversation with the event',
      description:
        'Open an event to see its participants and meeting details. Join the call from the event when it is time.',
    },
  ],
});
