export type SchedulingMode = 'individual' | 'collective' | 'roundRobin';
export type TimeWindow = { start: string; end: string };
export type WeeklyDay = { day: number; windows: TimeWindow[] };
export type DateOverride = { date: string; windows: TimeWindow[] };
export type AvailabilitySchedule = {
  id: string;
  name: string;
  timeZone: string;
  weekly: WeeklyDay[];
  overrides: DateOverride[];
};
export type BookingQuestion = { id: string; label: string; required: boolean };
export type EventType = {
  id: string;
  title: string;
  slug: string;
  description: string;
  durationMinutes: number;
  location: string;
  googleMeet: boolean;
  enabled: boolean;
  scheduleId: string;
  mode: SchedulingMode;
  hosts: string[];
  beforeMinutes: number;
  afterMinutes: number;
  noticeMinutes: number;
  horizonDays: number;
  intervalMinutes: number;
  dailyLimit: number | null;
  requiresConfirmation: boolean;
  questions: BookingQuestion[];
};
export type SchedulingProfile = {
  id: string;
  name: string;
  description: string;
  schedules: AvailabilitySchedule[];
  defaultScheduleId?: string | null;
  eventTypes: EventType[];
  revision: number;
};
export type SchedulingScope = {
  id: string;
  name: string;
  teamId?: string;
  canEdit: boolean;
};
export type SchedulingMember = { id: string; name: string; email: string };
export type BookingAttendance =
  | 'unknown'
  | 'attended'
  | 'guestNoShow'
  | 'hostNoShow';
export type Booking = {
  id: string;
  eventTypeId: string;
  title: string;
  name: string;
  email: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  hosts: string[];
  status: 'pending' | 'confirmed' | 'cancelled' | 'processing' | 'failed';
  attendance: BookingAttendance;
  rescheduleCount: number;
  rescheduledAt: string | null;
  location: string;
  answers: Record<string, string>;
};
export type PublicEvent = Pick<
  EventType,
  | 'id'
  | 'title'
  | 'slug'
  | 'description'
  | 'durationMinutes'
  | 'location'
  | 'googleMeet'
  | 'questions'
  | 'requiresConfirmation'
  | 'mode'
>;
export type PublicProfile = {
  id: string;
  name: string;
  description: string;
  eventTypes: PublicEvent[];
};
export type BookingRequest = {
  startsAt: string;
  name: string;
  email: string;
  timeZone: string;
  answers: Record<string, string>;
  requestId: string;
};
export type BookingReceipt = {
  booking: Booking;
  token: string;
  scheduleTimeZone: string;
};
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function newSchedule(timeZone: string): AvailabilitySchedule {
  return {
    id: crypto.randomUUID(),
    name: 'Working hours',
    timeZone,
    weekly: WEEKDAYS.map((_, day) => ({
      day,
      windows: day > 0 && day < 6 ? [{ start: '09:00', end: '17:00' }] : [],
    })),
    overrides: [],
  };
}

export function newEventType(
  scheduleId: string,
  hosts: string[],
  team: boolean
): EventType {
  return {
    id: crypto.randomUUID(),
    title: '',
    slug: '',
    description: '',
    durationMinutes: 30,
    location: '',
    googleMeet: true,
    enabled: false,
    scheduleId,
    mode: team ? 'collective' : 'individual',
    hosts,
    beforeMinutes: 0,
    afterMinutes: 0,
    noticeMinutes: 120,
    horizonDays: 60,
    intervalMinutes: 30,
    dailyLimit: null,
    requiresConfirmation: false,
    questions: [],
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function validateSchedule(
  schedule: AvailabilitySchedule
): string | undefined {
  if (!schedule.name.trim()) return 'Give this schedule a name.';
  try {
    new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone });
  } catch {
    return 'Choose a valid time zone.';
  }
  for (const day of [...schedule.weekly, ...schedule.overrides]) {
    const windows = [...day.windows].sort((a, b) =>
      a.start.localeCompare(b.start)
    );
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.end) ||
        w.start >= w.end
      )
        return 'Each time range must end after it starts.';
      if (i > 0 && windows[i - 1].end > w.start)
        return 'Time ranges cannot overlap.';
    }
  }
  if (
    new Set(schedule.overrides.map((o) => o.date)).size !==
    schedule.overrides.length
  )
    return 'Use only one override per date.';
}

export function validateEvent(
  event: EventType,
  others: EventType[]
): string | undefined {
  if (!event.title.trim()) return 'Give this event a title.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.slug))
    return 'Use lowercase letters, numbers, and hyphens for the link.';
  if (others.some((e) => e.id !== event.id && e.slug === event.slug))
    return 'Another event uses this link.';
  if (!event.hosts.length) return 'Choose at least one host.';
  if (
    !Number.isInteger(event.durationMinutes) ||
    event.durationMinutes < 5 ||
    event.durationMinutes > 480
  )
    return 'Duration must be 5–480 minutes.';
  if (
    !Number.isInteger(event.intervalMinutes) ||
    event.intervalMinutes < 5 ||
    event.intervalMinutes > 480
  )
    return 'Time-slot interval must be 5–480 minutes.';
  if (
    event.horizonDays < 1 ||
    event.horizonDays > 365 ||
    !Number.isInteger(event.horizonDays)
  )
    return 'Booking window must be 1–365 days.';
  if (
    [event.beforeMinutes, event.afterMinutes, event.noticeMinutes].some(
      (v) => !Number.isInteger(v) || v < 0 || v > 10080
    )
  )
    return 'Buffers and notice must be between 0 and 10,080 minutes.';
  if (
    event.dailyLimit !== null &&
    (!Number.isInteger(event.dailyLimit) ||
      event.dailyLimit < 1 ||
      event.dailyLimit > 100)
  )
    return 'Daily limit must be 1–100 bookings.';
  if (event.questions.some((q) => !q.label.trim()))
    return 'Every booking question needs a label.';
}
