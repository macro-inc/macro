export type SchedulingMode = 'individual' | 'collective' | 'roundRobin';
export type TimeWindow = { start: string; end: string };
export type WeeklyDay = {
  day: number;
  windows: TimeWindow[];
  /** Editor-only time-off annotations; omitted from API requests. */
  unavailableWindows?: TimeWindow[] | null;
};
export type DateOverride = {
  date: string;
  windows: TimeWindow[];
  /** Editor-only time-off annotations; omitted from API requests. */
  unavailableWindows?: TimeWindow[] | null;
};
/** Legacy gap inference can materialize more fragments than the bookable ranges. */
export const MAX_UNAVAILABLE_WINDOWS = 32;
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
  /** Create a Macro call and attach its join link when someone books. */
  macroCall: boolean;
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

export type EventValidationIssue = {
  field:
    | 'title'
    | 'slug'
    | 'durationMinutes'
    | 'hosts'
    | 'scheduleId'
    | 'intervalMinutes'
    | 'horizonDays'
    | 'beforeMinutes'
    | 'afterMinutes'
    | 'noticeMinutes'
    | 'dailyLimit'
    | 'questions';
  message: string;
  questionId?: string;
};

export const DEFAULT_BOOKING_RULES = {
  beforeMinutes: 0,
  afterMinutes: 0,
  noticeMinutes: 120,
  horizonDays: 60,
  intervalMinutes: 30,
  dailyLimit: null,
} satisfies Pick<
  EventType,
  | 'beforeMinutes'
  | 'afterMinutes'
  | 'noticeMinutes'
  | 'horizonDays'
  | 'intervalMinutes'
  | 'dailyLimit'
>;
export type SchedulingProfile = {
  id: string;
  name: string;
  description: string;
  schedules: AvailabilitySchedule[];
  defaultScheduleId?: string | null;
  eventTypes: EventType[];
  revision: number;
};

/** Persist bookable windows only; time-off annotations belong to the local draft. */
export function schedulingProfileForSave(profile: SchedulingProfile) {
  return {
    ...profile,
    schedules: profile.schedules.map((schedule) => ({
      ...schedule,
      weekly: schedule.weekly.map(({ day, windows }) => ({ day, windows })),
      overrides: schedule.overrides.map(({ date, windows }) => ({
        date,
        windows,
      })),
    })),
  };
}
export type SchedulingScope = {
  id: string;
  name: string;
  teamId?: string;
  /** May change booking links, schedules, and the booking page. */
  canEdit: boolean;
  /** May cancel, reschedule, and record attendance for any host's bookings. */
  canManageBookings: boolean;
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
  questionLabels?: Record<string, string>;
};
export type PublicEvent = Pick<
  EventType,
  | 'id'
  | 'title'
  | 'slug'
  | 'description'
  | 'durationMinutes'
  | 'location'
  | 'macroCall'
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
      unavailableWindows: [],
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
    macroCall: true,
    googleMeet: false,
    enabled: false,
    scheduleId,
    mode: team ? 'collective' : 'individual',
    hosts,
    ...DEFAULT_BOOKING_RULES,
    requiresConfirmation: false,
    questions: [],
  };
}

export function newDefaultBookingLink(
  scheduleId: string,
  userId: string,
  firstName: string
): EventType {
  const displayName = firstName || 'My';
  const title = `${displayName}'s Booking Link`;
  return {
    id: crypto.randomUUID(),
    title,
    slug: slugify(title),
    description: `Book a meeting with ${displayName}`,
    durationMinutes: 30,
    location: '',
    macroCall: true,
    googleMeet: false,
    enabled: true,
    scheduleId,
    mode: 'individual',
    hosts: [userId],
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

/** What guests see as the meeting place before a join link exists. */
export function meetingPlaceLabel(event: {
  macroCall?: boolean;
  googleMeet: boolean;
  location: string;
}): string {
  if (event.macroCall) return 'Macro call';
  if (event.googleMeet) return 'Video meeting';
  return event.location || 'Meeting';
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
    for (const ranges of [day.windows, day.unavailableWindows ?? []]) {
      const windows = [...ranges].sort((a, b) =>
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
    if ((day.unavailableWindows?.length ?? 0) > MAX_UNAVAILABLE_WINDOWS)
      return `Use at most ${MAX_UNAVAILABLE_WINDOWS} time-off ranges per day.`;
    if (
      day.windows.some((available) =>
        day.unavailableWindows?.some(
          (unavailable) =>
            available.start < unavailable.end &&
            available.end > unavailable.start
        )
      )
    )
      return 'Available hours and time off cannot overlap.';
  }
  if (
    new Set(schedule.overrides.map((o) => o.date)).size !==
    schedule.overrides.length
  )
    return 'Use only one override per date.';
}

/** Structured validation is the source of truth for both editor and legacy messages. */
export function eventIdentityIssues(
  event: EventType,
  others: EventType[]
): EventValidationIssue[] {
  const issues: EventValidationIssue[] = [];
  if (!event.title.trim())
    issues.push({ field: 'title', message: 'Give this event a title.' });
  if (event.slug.trim()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.slug))
      issues.push({
        field: 'slug',
        message: 'Use lowercase letters, numbers, and hyphens for the link.',
      });
    else if (others.some((e) => e.id !== event.id && e.slug === event.slug))
      issues.push({ field: 'slug', message: 'Another event uses this link.' });
  }
  return issues;
}

export function eventHostIssues(event: EventType): EventValidationIssue[] {
  return event.hosts.length
    ? []
    : [{ field: 'hosts', message: 'Choose at least one host.' }];
}

export function eventDurationIssues(event: EventType): EventValidationIssue[] {
  return !Number.isInteger(event.durationMinutes) ||
    event.durationMinutes < 5 ||
    event.durationMinutes > 480
    ? [
        {
          field: 'durationMinutes',
          message: 'Duration must be between 5 mins and 8 hours.',
        },
      ]
    : [];
}

export function eventRuleIssues(event: EventType): EventValidationIssue[] {
  const issues: EventValidationIssue[] = [];
  if (
    !Number.isInteger(event.intervalMinutes) ||
    event.intervalMinutes < 5 ||
    event.intervalMinutes > 480
  )
    issues.push({
      field: 'intervalMinutes',
      message: 'Time-slot interval must be 5–480 minutes.',
    });
  if (
    event.horizonDays < 1 ||
    event.horizonDays > 365 ||
    !Number.isInteger(event.horizonDays)
  )
    issues.push({
      field: 'horizonDays',
      message: 'Booking window must be 1–365 days.',
    });
  for (const field of [
    'beforeMinutes',
    'afterMinutes',
    'noticeMinutes',
  ] as const) {
    const value = event[field];
    if (!Number.isInteger(value) || value < 0 || value > 10080)
      issues.push({
        field,
        message: 'Buffers and notice must be between 0 and 10,080 minutes.',
      });
  }
  if (
    !issues.some(
      ({ field }) => field === 'horizonDays' || field === 'noticeMinutes'
    ) &&
    event.noticeMinutes >= event.horizonDays * 1440
  )
    issues.push({
      field: 'horizonDays',
      message: 'The booking window must extend beyond the notice period.',
    });
  if (
    event.dailyLimit !== null &&
    (!Number.isInteger(event.dailyLimit) ||
      event.dailyLimit < 1 ||
      event.dailyLimit > 100)
  )
    issues.push({
      field: 'dailyLimit',
      message: 'Daily limit must be 1–100 bookings.',
    });
  return issues;
}

export function eventQuestionIssues(event: EventType): EventValidationIssue[] {
  return event.questions
    .filter((question) => !question.label.trim())
    .map((question) => ({
      field: 'questions',
      questionId: question.id,
      message: 'Every booking question needs a label.',
    }));
}

export function eventValidationIssues(
  event: EventType,
  others: EventType[]
): EventValidationIssue[] {
  return [
    ...eventIdentityIssues(event, others),
    ...eventHostIssues(event),
    ...eventDurationIssues(event),
    ...eventRuleIssues(event),
    ...eventQuestionIssues(event),
  ];
}

export function validateEventIdentity(
  event: EventType,
  others: EventType[]
): string | undefined {
  return eventIdentityIssues(event, others)[0]?.message;
}

export function validateEventHosts(event: EventType): string | undefined {
  return eventHostIssues(event)[0]?.message;
}

export function validateEventDuration(event: EventType): string | undefined {
  return eventDurationIssues(event)[0]?.message;
}

export function validateEventRules(event: EventType): string | undefined {
  return eventRuleIssues(event)[0]?.message;
}

export function validateEventQuestions(event: EventType): string | undefined {
  return eventQuestionIssues(event)[0]?.message;
}

export function validateEvent(
  event: EventType,
  others: EventType[]
): string | undefined {
  return eventValidationIssues(event, others)[0]?.message;
}
