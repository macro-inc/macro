import {
  type AttentionReason,
  type DeliveryIssue,
  type Enrollment,
  isOnScheduler,
  LIVE_STATUSES,
  type QueuedStep,
  type Sender,
  type SenderStatus,
} from './model';

/** A record still preparing after this long was abandoned mid-scheduling. */
const INTERRUPTED_AFTER_MS = 15 * 60_000;

/** A step to read back from the scheduler. */
export type InspectedStep = {
  draftId: string;
  generation?: number;
  threadId?: string;
  sendAt: string;
  /** The record says the scheduler has it: queued, or already handed to Gmail. */
  queued: boolean;
};

export type Inspection = {
  issues: Record<string, DeliveryIssue>;
  untracked: string[];
  /** Steps that left the scheduler after their send time: sent. */
  sent: string[];
};

/** `undefined` until the user's inboxes have loaded. */
export function senderStatusOf(
  senders: Sender[] | undefined,
  senderId: string
): SenderStatus | undefined {
  if (!senders) return undefined;
  const sender = senders.find((item) => item.id === senderId);
  if (!sender) return 'disconnected';
  return sender.ready ? 'ready' : 'reauth';
}

/**
 * Steps handed to the scheduler, including ones already sent, grouped by an
 * inbox the user still has.
 */
export function inspectionTargets(
  enrollments: Enrollment[],
  senderStatus: (senderId: string) => SenderStatus | undefined
) {
  const bySender = new Map<string, InspectedStep[]>();
  for (const entry of enrollments) {
    const status = senderStatus(entry.senderId);
    if (status !== 'ready' && status !== 'reauth') continue;
    for (const step of entry.steps) {
      if (!step.draftId || !isOnScheduler(step)) continue;
      const targets = bySender.get(entry.senderId) ?? [];
      targets.push({
        draftId: step.draftId,
        generation: step.draftGeneration,
        threadId: step.threadId,
        sendAt: step.sendAt,
        queued: step.status !== 'scheduling',
      });
      bySender.set(entry.senderId, targets);
    }
  }
  return bySender;
}

/**
 * The most pressing problem with an enrollment that its stored status does
 * not show: a disconnected inbox, then the first step the scheduler flags.
 */
export function attentionFor(
  entry: Enrollment,
  senderStatus: (senderId: string) => SenderStatus | undefined,
  issues: Record<string, DeliveryIssue>
): AttentionReason | undefined {
  if (
    LIVE_STATUSES.includes(entry.status) &&
    senderStatus(entry.senderId) === 'disconnected'
  )
    return 'disconnected';
  if (
    entry.status === 'preparing' &&
    Date.now() - new Date(entry.updatedAt).getTime() > INTERRUPTED_AFTER_MS
  )
    return 'interrupted';
  for (const step of entry.steps) {
    const issue = step.draftId ? issues[step.draftId] : undefined;
    if (issue) return issue;
  }
  return undefined;
}

/** Whether an enrollment needs the user, by status or by delivery problem. */
export function needsAttention(
  entry: Enrollment,
  senderStatus: (senderId: string) => SenderStatus | undefined,
  issues: Record<string, DeliveryIssue>
) {
  return (
    entry.status === 'needs_attention' ||
    attentionFor(entry, senderStatus, issues) !== undefined
  );
}

/**
 * Read scheduler state for queued steps, one inbox at a time: problems by
 * draft id, sent steps, and untracked sequence emails by inbox.
 */
export async function collectIssues(
  inspect: (senderId: string, steps: InspectedStep[]) => Promise<Inspection>,
  bySender: Map<string, InspectedStep[]>
) {
  const senders = [...bySender];
  const results = await Promise.allSettled(
    senders.map(([senderId, steps]) => inspect(senderId, steps))
  );
  const found: Record<string, DeliveryIssue> = {};
  const untracked: Record<string, string[]> = {};
  const sent = new Set<string>();
  for (const [index, result] of results.entries()) {
    if (result.status !== 'fulfilled') continue;
    Object.assign(found, result.value.issues);
    for (const draftId of result.value.sent) sent.add(draftId);
    if (result.value.untracked.length)
      untracked[senders[index][0]] = result.value.untracked;
  }
  const failed = results.find((result) => result.status === 'rejected');
  return {
    found,
    untracked,
    sent,
    failed: failed?.status === 'rejected' ? failed : undefined,
  };
}

/** Handed to Gmail, or seen leaving the scheduler after its time. */
export function isStepSent(step: QueuedStep, sent: ReadonlySet<string>) {
  return (
    step.status === 'delivery_started' ||
    (step.status === 'queued' && !!step.draftId && sent.has(step.draftId))
  );
}

export function sentSteps(entry: Enrollment, sent: ReadonlySet<string>) {
  return entry.steps.filter((step) => isStepSent(step, sent)).length;
}

/** A scheduled enrollment with nothing left to send. */
export function isFinished(entry: Enrollment, sent: ReadonlySet<string>) {
  return (
    entry.status === 'scheduled' &&
    entry.steps.every(
      (step) => step.status === 'canceled' || isStepSent(step, sent)
    )
  );
}
