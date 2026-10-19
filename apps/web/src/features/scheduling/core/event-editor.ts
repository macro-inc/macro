import { match } from 'ts-pattern';
import {
  DAY_UNITS,
  describeBookingValue,
  MINUTE_UNITS,
  NOTICE_UNITS,
} from './booking-units';
import {
  type BookingQuestion,
  DEFAULT_BOOKING_RULES,
  type EventType,
  type EventValidationIssue,
  eventDurationIssues,
  eventHostIssues,
  eventIdentityIssues,
  eventQuestionIssues,
  eventRuleIssues,
  eventValidationIssues,
  slugify,
} from './types';

export type EventDetail = 'link' | 'rules' | 'questions' | 'hosts';
export const EVENT_EDITOR_STEPS = [
  { id: 'details', label: 'Details', heading: 'Meeting details' },
  {
    id: 'location',
    label: 'Location & availability',
    heading: 'Location & availability',
  },
  {
    id: 'questions',
    label: 'Questions',
    heading: 'Questions',
  },
  { id: 'rules', label: 'Booking rules', heading: 'Booking rules' },
  { id: 'review', label: 'Review', heading: 'Review' },
] as const;

export type EventEditorStep = (typeof EVENT_EDITOR_STEPS)[number]['id'];

/** Blank custom links receive a stable, unique title-based URL before saving. */
export function bookingLinkSlug(event: EventType, others: EventType[]): string {
  if (event.slug.trim()) return event.slug;
  const base = slugify(event.title).replace(/-+$/, '') || 'booking';
  const existing = new Set(
    others.filter((entry) => entry.id !== event.id).map((entry) => entry.slug)
  );
  let slug = base;
  let suffix = 2;
  while (existing.has(slug)) {
    const ending = `-${suffix++}`;
    slug = `${base.slice(0, 80 - ending.length).replace(/-+$/, '')}${ending}`;
  }
  return slug;
}

/** Empty question rows are editor placeholders, not configured booking questions. */
export function configuredBookingQuestions(
  questions: BookingQuestion[]
): BookingQuestion[] {
  return questions.filter((question) => question.label.trim());
}
export function eventEditorStepIssues(
  event: EventType,
  others: EventType[],
  step: EventEditorStep
): EventValidationIssue[] {
  return match(step)
    .with('details', () => [
      ...eventIdentityIssues(event, others),
      ...eventDurationIssues(event),
    ])
    .with('location', () => [
      ...(!event.scheduleId
        ? [
            {
              field: 'scheduleId' as const,
              message: 'Choose an availability schedule.',
            },
          ]
        : []),
      ...eventHostIssues(event),
    ])
    .with('questions', () =>
      eventQuestionIssues({
        ...event,
        questions: configuredBookingQuestions(event.questions),
      })
    )
    .with('rules', () => eventRuleIssues(event))
    .with('review', () =>
      eventValidationIssues(
        { ...event, questions: configuredBookingQuestions(event.questions) },
        others
      )
    )
    .exhaustive();
}

export function eventEditorStepError(
  event: EventType,
  others: EventType[],
  step: EventEditorStep
): string | undefined {
  return eventEditorStepIssues(event, others, step)[0]?.message;
}

export function hasCustomBookingRules(event: EventType): boolean {
  return (
    event.beforeMinutes !== DEFAULT_BOOKING_RULES.beforeMinutes ||
    event.afterMinutes !== DEFAULT_BOOKING_RULES.afterMinutes ||
    event.noticeMinutes !== DEFAULT_BOOKING_RULES.noticeMinutes ||
    event.horizonDays !== DEFAULT_BOOKING_RULES.horizonDays ||
    event.intervalMinutes !== DEFAULT_BOOKING_RULES.intervalMinutes ||
    event.dailyLimit !== DEFAULT_BOOKING_RULES.dailyLimit
  );
}

/** Summarize changed rules instead of hiding them behind unchanged defaults. */
export function bookingRulesSummary(event: EventType): string {
  const summaries: string[] = [];
  if (event.beforeMinutes !== DEFAULT_BOOKING_RULES.beforeMinutes)
    summaries.push(
      `${describeBookingValue(event.beforeMinutes, MINUTE_UNITS)} before`
    );
  if (event.afterMinutes !== DEFAULT_BOOKING_RULES.afterMinutes)
    summaries.push(
      `${describeBookingValue(event.afterMinutes, MINUTE_UNITS)} after`
    );
  if (event.noticeMinutes !== DEFAULT_BOOKING_RULES.noticeMinutes)
    summaries.push(
      event.noticeMinutes === 0
        ? 'No minimum notice'
        : `${describeBookingValue(event.noticeMinutes, NOTICE_UNITS)} notice`
    );
  if (event.horizonDays !== DEFAULT_BOOKING_RULES.horizonDays)
    summaries.push(
      `${describeBookingValue(event.horizonDays, DAY_UNITS)} ahead`
    );
  if (event.intervalMinutes !== DEFAULT_BOOKING_RULES.intervalMinutes)
    summaries.push(
      `${describeBookingValue(event.intervalMinutes, MINUTE_UNITS)} interval`
    );
  if (
    event.dailyLimit !== DEFAULT_BOOKING_RULES.dailyLimit &&
    event.dailyLimit !== null
  )
    summaries.push(
      `${event.dailyLimit} booking${event.dailyLimit === 1 ? '' : 's'} per day`
    );
  return summaries.join(' · ') || 'No custom rules';
}

/** Removing an optional section resets its values, not just its presentation. */
export function resetEventDetail(
  event: EventType,
  detail: EventDetail,
  defaultHosts: string[],
  defaultMode: 'individual' | 'collective'
): EventType {
  return match(detail)
    .returnType<EventType>()
    .with('link', () => ({ ...event, slug: slugify(event.title) }))
    .with('rules', () => ({ ...event, ...DEFAULT_BOOKING_RULES }))
    .with('questions', () => ({ ...event, questions: [] }))
    .with('hosts', () => ({
      ...event,
      hosts: [...defaultHosts],
      mode: defaultMode,
    }))
    .exhaustive();
}
