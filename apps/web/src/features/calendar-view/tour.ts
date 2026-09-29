import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const CALENDAR_TOUR = defineTourTargets('calendar', [
  'sources',
  'availability',
  'upcoming',
  'period',
  'grid',
  'sidebarToggle',
]);

/**
 * Touch and preview headers have their own sidebar toggle; the desktop
 * workspace uses the shell's.
 */
const openSidebar = {
  entry: [CALENDAR_TOUR.sidebarToggle, VIEW_SHELL_TOUR.sidebarToggle],
  entryLabel: 'Show the calendar sidebar to continue',
};

export const calendarTour = defineViewTour({
  id: 'calendar',
  title: 'Calendar',
  connector: { kind: 'email', label: 'Google' },
  steps: [
    {
      // The Calendars list only appears with more than one calendar.
      target: [CALENDAR_TOUR.sources, VIEW_SHELL_TOUR.aside],
      ...openSidebar,
      missingHint:
        'Connect another Google account to choose which calendars to show here.',
      title: 'All your calendars, one schedule',
      description:
        'Connect multiple Google accounts and see work, personal, and shared calendars together. Expand an account here to toggle individual calendars.',
    },
    {
      // Copy availability needs a connected Google calendar.
      target: [CALENDAR_TOUR.availability, CALENDAR_TOUR.upcoming],
      ...openSidebar,
      missingHint: 'Connect a Google calendar to copy your availability.',
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
