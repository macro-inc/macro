import type { CalendarEvent, CalendarSource } from './types';

const TEAM_CALENDAR: CalendarSource = {
  id: 'team',
  name: 'Team calendar',
  color: 'var(--color-calendar)',
};

const PROJECT_CALENDAR: CalendarSource = {
  id: 'project',
  name: 'Project calendar',
  color: 'var(--color-accent)',
};

const PERSONAL_CALENDAR: CalendarSource = {
  id: 'personal',
  name: 'Personal calendar',
  color: 'var(--color-success)',
};

const offsetDate = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const atTime = (date: Date, hours: number, minutes = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);

const localDateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

/** Creates representative fixture events around the supplied local date. */
export function createCalendarEventFixtures(
  referenceDate = new Date()
): CalendarEvent[] {
  const today = offsetDate(referenceDate, 0);
  const tomorrow = offsetDate(referenceDate, 1);
  const fixtureHour = Math.min(16, Math.max(9, referenceDate.getHours() + 1));

  return [
    {
      id: 'team-planning',
      title: 'Weekly planning',
      start: atTime(today, fixtureHour).toISOString(),
      end: atTime(today, fixtureHour + 1).toISOString(),
      allDay: false,
      calendar: TEAM_CALENDAR,
      location: 'Project room',
      description:
        'Review priorities, open decisions, and ownership for the week.',
    },
    {
      id: 'design-review',
      title: 'Calendar design review',
      start: atTime(today, fixtureHour, 30).toISOString(),
      end: atTime(today, fixtureHour + 2).toISOString(),
      allDay: false,
      calendar: PROJECT_CALENDAR,
      location: 'Design studio',
      description:
        'Review the event layouts across month, week, and day views.',
    },
    {
      id: 'launch-day',
      title: 'Launch day',
      start: localDateString(today),
      end: localDateString(tomorrow),
      allDay: true,
      calendar: PROJECT_CALENDAR,
      description:
        'Keep the day clear for release checks and launch coordination.',
    },
    {
      id: 'release-checklist',
      title: 'Release checklist due',
      start: localDateString(today),
      end: localDateString(tomorrow),
      allDay: true,
      calendar: TEAM_CALENDAR,
      description: 'Complete the final release checklist before launch.',
    },
    {
      id: 'support-rotation',
      title: 'Support rotation',
      start: localDateString(today),
      end: localDateString(tomorrow),
      allDay: true,
      calendar: PERSONAL_CALENDAR,
      location: 'Remote',
    },
    {
      id: 'offsite',
      title: 'Company offsite',
      start: localDateString(offsetDate(referenceDate, 2)),
      end: localDateString(offsetDate(referenceDate, 5)),
      allDay: true,
      calendar: TEAM_CALENDAR,
      location: 'Lake House',
    },
    {
      id: 'customer-research',
      title: 'Customer research synthesis and next-step planning',
      start: atTime(tomorrow, 14).toISOString(),
      end: atTime(tomorrow, 15, 30).toISOString(),
      allDay: false,
      calendar: PERSONAL_CALENDAR,
      location: 'Remote',
      description:
        'Turn the latest interview notes into themes and follow-up work.',
    },
    {
      id: 'focus-time',
      title: 'Focus time',
      start: atTime(offsetDate(referenceDate, -1), 10).toISOString(),
      end: atTime(offsetDate(referenceDate, -1), 12).toISOString(),
      allDay: false,
      calendar: PERSONAL_CALENDAR,
    },
  ];
}
