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

/** What the editor changes: everything but status and version. */
export type SequenceDraft = Pick<
  Sequence,
  'name' | 'linkId' | 'footer' | 'steps'
>;

/** A sequence changes only while it is not sending. */
export function isEditable(status: SequenceStatus) {
  return status !== 'active';
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

/** A plain copy of what the editor changes, as the server stores it. */
export function toDraft(sequence: SequenceDraft): SequenceDraft {
  return {
    name: sequence.name,
    linkId: sequence.linkId ?? null,
    footer: sequence.footer,
    steps: normalizeSteps(sequence.steps),
  };
}

/**
 * Steps as the server stores them: the first is never a reply and never
 * waits, since it goes out at the enrollment's start.
 */
function normalizeSteps(steps: readonly Step[]): Step[] {
  return steps.map((step, index) => ({
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
): Omit<UpdateSequenceRequest, 'version'> | undefined {
  const base = toDraft(saved);
  const steps = normalizeSteps(draft.steps);
  const changes: Omit<UpdateSequenceRequest, 'version'> = {
    ...(draft.name !== base.name && { name: draft.name }),
    ...((draft.linkId ?? null) !== base.linkId && { linkId: draft.linkId }),
    ...(draft.footer !== base.footer && { footer: draft.footer }),
    ...(JSON.stringify(steps) !== JSON.stringify(base.steps) && { steps }),
  };
  return Object.keys(changes).length ? changes : undefined;
}

const LIVE_STATUSES: readonly EnrollmentStatus[] = [
  'active',
  'paused',
  'needs_attention',
];
/**
 * A stop that a resume can undo: the server may have misread a reply or
 * bounce, or access may be back (the server checks it again before sending).
 */
const RESUMABLE_STOPS: readonly EnrollmentReason[] = [
  'replied',
  'bounced',
  'access_lost',
];
/** A step that never went out, so resuming sends it again. */
const RETRY_REASONS: readonly EnrollmentReason[] = [
  'step_failed',
  'step_withdrawn',
];

type EnrollmentState = Pick<EnrollmentSummary, 'status' | 'reason'>;

function isLive(status: EnrollmentStatus) {
  return LIVE_STATUSES.includes(status);
}

/** What an enrollment shows: a paused sequence holds its active enrollments. */
export function shownStatus(
  enrollment: Pick<EnrollmentSummary, 'status'>,
  sequencePaused: boolean
): EnrollmentStatus {
  return sequencePaused && enrollment.status === 'active'
    ? 'paused'
    : enrollment.status;
}

/**
 * The owner actions an enrollment offers, in display order. Pause and resume
 * wait for a sending sequence, which is what resumes a paused one's people.
 * Anyone not already opted out can be unsubscribed, even after a reply.
 */
export function enrollmentActions(
  enrollment: EnrollmentState,
  sequenceStatus: SequenceStatus
): EnrollmentAction[] {
  const { status, reason } = enrollment;
  const sending = sequenceStatus === 'active';
  const actions: EnrollmentAction[] = [];
  const resumable =
    status === 'paused' ||
    status === 'needs_attention' ||
    (status === 'stopped' && !!reason && RESUMABLE_STOPS.includes(reason));
  if (sending && resumable) actions.push('resume');
  if (sending && (status === 'active' || status === 'needs_attention'))
    actions.push('pause');
  if (isLive(status)) actions.push('stop');
  if (reason !== 'unsubscribed') actions.push('unsubscribe');
  return actions;
}

/** Resuming resends a step that never went out: the action reads Retry. */
export function isRetry(enrollment: EnrollmentState) {
  return !!enrollment.reason && RETRY_REASONS.includes(enrollment.reason);
}

/** Enrollments that need the owner across sequences: the sidebar count. */
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
