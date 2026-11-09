import type {
  EnrollmentAction,
  EnrollmentReason,
  EnrollmentStatus,
  EnrollmentSummary,
  Link,
  Sequence,
  SequenceStatus,
  SequenceSummary,
  Step,
  UpdateSequenceRequest,
} from '@service-email/generated/schemas';
import { v7 as uuidv7 } from 'uuid';

/** Limits the server enforces; the editor stops at them. */
export const SEQUENCE_LIMITS = {
  name: 200,
  footer: 300,
  steps: 20,
  subject: 300,
  body: 50_000,
  delayDays: 365,
  contacts: 50,
} as const;

/** Personalization the server fills in for each person. */
export const PERSONALIZATION_TOKENS = [
  '{{firstName}}',
  '{{name}}',
  '{{email}}',
] as const;

export type PersonalizationToken = (typeof PERSONALIZATION_TOKENS)[number];

/** `value` with `token` in place of the selection, and the caret after it. */
export function insertToken(
  value: string,
  start: number,
  end: number,
  token: PersonalizationToken
) {
  return {
    value: value.slice(0, start) + token + value.slice(end),
    caret: start + token.length,
  };
}

export type SequenceDraft = Pick<
  Sequence,
  'name' | 'linkId' | 'footer' | 'steps'
>;

/** A blank follow-up. The server keys each step's history by its id. */
export function blankStep(): Step {
  return { id: uuidv7(), delayDays: 2, subject: '', body: '', asReply: true };
}

/** A follow-up that replies in its thread; the first email never does. */
export function isReplyStep(steps: readonly Step[], index: number) {
  return index > 0 && steps[index]?.asReply === true;
}

/** The subject a step goes out with: a reply answers its thread's first email. */
export function stepSubject(steps: readonly Step[], index: number) {
  let root = index;
  while (isReplyStep(steps, root)) root--;
  const subject = steps[root]?.subject ?? '';
  if (root === index || /^re:/i.test(subject.trim())) return subject;
  return `Re: ${subject}`;
}

/**
 * A plain copy of what the editor changes, as the server stores it. The copy
 * matters: the query store updates a cached sequence in place.
 */
export function toDraft(sequence: SequenceDraft): SequenceDraft {
  return {
    name: sequence.name,
    linkId: sequence.linkId ?? null,
    footer: sequence.footer,
    steps: normalizeSteps(sequence.steps),
  };
}

/** The first step goes out at the enrollment's start: no wait, no reply. */
function normalizeSteps(steps: readonly Step[]): Step[] {
  return steps.map((step, index) => ({
    id: step.id,
    delayDays: index === 0 ? 0 : step.delayDays,
    subject: step.subject,
    body: step.body,
    asReply: isReplyStep(steps, index),
  }));
}

/** The fields a draft changed, or `undefined` when it matches `saved`. */
export function draftChanges(
  saved: SequenceDraft,
  draft: SequenceDraft
): UpdateSequenceRequest | undefined {
  const base = toDraft(saved);
  const steps = normalizeSteps(draft.steps);
  const changes: UpdateSequenceRequest = {
    ...(draft.name !== base.name && { name: draft.name }),
    ...((draft.linkId ?? null) !== base.linkId && { linkId: draft.linkId }),
    ...(draft.footer !== base.footer && { footer: draft.footer }),
    ...(JSON.stringify(steps) !== JSON.stringify(base.steps) && { steps }),
  };
  return Object.keys(changes).length ? changes : undefined;
}

/** The server may have misread a reply or bounce. */
const RESUMABLE_STOPS: readonly EnrollmentReason[] = ['replied', 'bounced'];

type EnrollmentState = Pick<
  EnrollmentSummary,
  'status' | 'reason' | 'crmContactId'
>;

/** A stop that resuming can undo; an archived person may be back in the CRM. */
function resumableStop({ reason, crmContactId }: EnrollmentState) {
  if (reason === 'contact_removed') return !!crmContactId;
  return !!reason && RESUMABLE_STOPS.includes(reason);
}

/** A sequence that isn't sending holds its active enrollments. */
export function shownStatus(
  enrollment: Pick<EnrollmentSummary, 'status'>,
  sequenceHeld: boolean
): EnrollmentStatus {
  return sequenceHeld && enrollment.status === 'active'
    ? 'paused'
    : enrollment.status;
}

/**
 * The owner actions an enrollment offers, in display order. Pause and resume
 * wait for a sending sequence: resuming the sequence is what moves its
 * people. Anyone not opted out can be unsubscribed, even after a reply.
 */
export function enrollmentActions(
  enrollment: EnrollmentState,
  sequenceStatus: SequenceStatus
): EnrollmentAction[] {
  const { status, reason } = enrollment;
  const sending = sequenceStatus === 'active';
  const live =
    status === 'active' || status === 'paused' || status === 'needs_attention';
  const resumable =
    status === 'paused' ||
    status === 'needs_attention' ||
    (status === 'stopped' && resumableStop(enrollment));
  const actions: EnrollmentAction[] = [];
  if (sending && resumable) actions.push('resume');
  if (sending && (status === 'active' || status === 'needs_attention'))
    actions.push('pause');
  if (live) actions.push('stop');
  if (reason !== 'unsubscribed') actions.push('unsubscribe');
  return actions;
}

/** Enrollments whose email didn't go out, across sequences: the sidebar count. */
export function needsAttentionTotal(sequences: readonly SequenceSummary[]) {
  return sequences.reduce(
    (total, sequence) => total + sequence.counts.needsAttention,
    0
  );
}

/**
 * Inboxes a sequence can send from: the owner's own Gmail links. The links
 * list also holds inboxes delegated to them and Outlook ones.
 */
export function ownGmailSenders(links: readonly Link[], userId: string) {
  return links
    .filter((link) => link.provider === 'GMAIL' && link.macro_id === userId)
    .map((link) => ({
      id: link.id,
      email: link.email_address,
      ready: link.is_sync_active && !link.needs_reauth,
    }));
}
