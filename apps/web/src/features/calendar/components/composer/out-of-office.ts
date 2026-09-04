import type { OutOfOfficeAutoDeclineMode } from '@service-email/generated/schemas/outOfOfficeAutoDeclineMode';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import { match } from 'ts-pattern';

/** The kind of event the composer can create. */
export type EventEditorEventKind = 'default' | 'out_of_office';

/** Editor state for an out-of-office event's decline behavior. */
export interface EventEditorOutOfOffice {
  autoDeclineMode: OutOfOfficeAutoDeclineMode;
  declineMessage: string;
}

/** The editor kind an event type maps to; only out-of-office is its own kind. */
export function eventKindOf(
  eventType: EventType | undefined
): EventEditorEventKind {
  return eventType === 'out_of_office' ? 'out_of_office' : 'default';
}

/** What the composer's kind pill displays for an event type. */
export function eventKindLabel(eventType: EventType | undefined) {
  return match(eventType)
    .with('out_of_office', () => 'Out of office')
    .with('focus_time', () => 'Focus time')
    .with('working_location', () => 'Working location')
    .with('birthday', () => 'Birthday')
    .otherwise(() => 'Event');
}

/**
 * The consequential side effects of an out-of-office save, so a composer can
 * disclose them before the user confirms. Without this an event that looks
 * ordinary would silently write an away block and auto-decline meetings.
 */
export type OutOfOfficeNotice = {
  /** Plain-language description of the away status and auto-decline behavior. */
  effect: string;
  /** The reply sent to auto-declined organizers, when one is set. */
  declineMessage?: string;
};

/** Describe the away status and auto-decline behavior an OOO save applies. */
export function outOfOfficeNoticeFor(
  autoDeclineMode: OutOfOfficeAutoDeclineMode | undefined,
  declineMessage?: string | null
): OutOfOfficeNotice {
  const effect = match(autoDeclineMode ?? 'decline_none')
    .with(
      'decline_all_conflicting_invitations',
      () =>
        'Google will show you as away and automatically decline all conflicting invitations.'
    )
    .with(
      'decline_only_new_conflicting_invitations',
      () =>
        'Google will show you as away and automatically decline newly received conflicting invitations.'
    )
    .otherwise(
      () =>
        'Google will show you as away for this time; conflicting invitations are left untouched.'
    );
  return { effect, declineMessage: declineMessage?.trim() || undefined };
}
