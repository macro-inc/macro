import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type { DraftRef, SequenceDelivery } from '../context/contracts';
import type { InspectedStep } from '../core/attention';
import { MarketingError } from '../core/errors';
import type { DeliveryIssue } from '../core/model';

type ResultErrors = { code: string; message: string }[];

function describe(errors: ResultErrors) {
  return errors.map((error) => error.message).join('; ');
}

/** Nothing left to act on: the schedule or the message no longer exists. */
function allNotFound(errors: ResultErrors) {
  return errors.every((error) => error.code === 'NOT_FOUND');
}

type CancelOutcome = 'canceled' | 'delivery_started' | { retry: number };

/** Marks scheduled sends as sequence steps, which Mail's lists leave out. */
const SEQUENCE_SOURCE = 'sequence';

/** Past-due steps still on the scheduler after this long are reported as stalled. */
const STALLED_AFTER_MS = 15 * 60_000;
/** Scheduled list pages per inbox; the server caps a page at 1000 messages. */
const SCHEDULED_PAGE_SIZE = 1000;
const MAX_SCHEDULED_PAGES = 5;
/** Thread reads used to explain stalled steps, per inspection. */
const MAX_STATUS_READS = 10;

type DraftState =
  | { kind: 'gone' }
  | { kind: 'unknown' }
  | {
      kind: 'found';
      /** Undefined when only the generation could be read. */
      sent?: boolean;
      delivering?: boolean;
      status?: string | null;
      generation?: number;
    };

/** The message's delivery state from one thread, if the thread holds it. */
async function readFromThread(
  threadId: string,
  draftId: string
): Promise<DraftState | undefined> {
  const thread = await emailClient.getThread({
    thread_id: threadId,
    limit: 50,
  });
  if (thread.isErr()) return undefined;
  const message = thread.value.thread.messages.find(
    (item) => item.db_id === draftId
  );
  if (!message) return undefined;
  return {
    kind: 'found',
    sent: message.is_sent,
    delivering:
      message.scheduled_send_status === 'sending' ||
      message.scheduled_send_status === 'unconfirmed',
    status: message.scheduled_send_status,
    generation: message.draft_generation,
  };
}

/**
 * Read a draft's delivery state. The thread read carries send status. The
 * message read decides whether it still exists: inbox sync can move a sent
 * step into another thread, and rows saved before thread ids omit one.
 */
async function readDraftState(draft: DraftRef): Promise<DraftState> {
  if (draft.threadId) {
    const state = await readFromThread(draft.threadId, draft.draftId);
    if (state) return state;
  }
  const message = await emailClient.getMessage({ message_id: draft.draftId });
  if (message.isErr())
    return allNotFound(message.error) ? { kind: 'gone' } : { kind: 'unknown' };
  const moved =
    message.value.thread_db_id !== draft.threadId
      ? await readFromThread(message.value.thread_db_id, draft.draftId)
      : undefined;
  return moved ?? { kind: 'found', generation: message.value.draft_generation };
}

async function cancelOnce(
  senderId: string,
  draft: DraftRef,
  generation: number
): Promise<CancelOutcome> {
  const unscheduled = await emailClient.unscheduleMessage(
    { draftID: draft.draftId, draftGeneration: generation },
    senderId
  );
  // No schedule and no message both mean nothing is left to send.
  const removed = unscheduled.isOk() || allNotFound(unscheduled.error);
  if (removed) {
    const deleted = await emailClient.deleteDraft(
      { id: draft.draftId, draftGeneration: generation },
      senderId
    );
    if (deleted.isOk() || allNotFound(deleted.error)) return 'canceled';
    // 409: already sent, mid-send, or edited elsewhere. Decide from state.
    return resolveConflict(draft, generation, describe(deleted.error));
  }
  // 400 is the server's delivery conflict, which also covers an edited draft
  // and an in-progress composer send; 500 can be a generation conflict.
  // The error text cannot tell these apart, so read the draft.
  return resolveConflict(draft, generation, describe(unscheduled.error));
}

async function resolveConflict(
  draft: DraftRef,
  generation: number,
  reason: string
): Promise<CancelOutcome> {
  const state = await readDraftState(draft);
  if (state.kind === 'gone') return 'canceled';
  if (state.kind === 'found') {
    if (state.sent || state.delivering) return 'delivery_started';
    if (state.generation !== undefined && state.generation !== generation)
      return { retry: state.generation };
  }
  throw new MarketingError('cancelFailed', { reason });
}

/** The inbox's unsent sequence emails, and whether the list is whole. */
async function listScheduled(senderId: string) {
  const ids = new Set<string>();
  for (let page = 0; page < MAX_SCHEDULED_PAGES; page++) {
    const result = await throwOnErr(() =>
      emailClient.getScheduledMessages(
        {
          offset: page * SCHEDULED_PAGE_SIZE,
          limit: SCHEDULED_PAGE_SIZE,
          source: SEQUENCE_SOURCE,
        },
        senderId
      )
    );
    for (const message of result.messages) ids.add(message.db_id);
    if (result.messages.length < SCHEDULED_PAGE_SIZE)
      return { ids, complete: true };
  }
  // Past the page cap an unseen step may simply be on a later page.
  return { ids, complete: false };
}

export function createGmailSequenceDelivery(): SequenceDelivery {
  return {
    async createDraft(senderId, content) {
      const result = await throwOnErr(() =>
        emailClient.createDraft(
          {
            draft: {
              subject: content.subject,
              body_text: content.body,
              to: [{ email: content.email }],
              include_signature: false,
              replying_to_id: content.replyingToId,
              // Each step is its own draft; never continue the user's reply.
              reuse_reply_draft: false,
            },
          },
          senderId
        )
      );
      if (!result.draft.db_id) throw new MarketingError('draftIdMissing');
      return {
        id: result.draft.db_id,
        generation: result.draft.draft_generation ?? 0,
        threadId: result.draft.thread_db_id ?? undefined,
      };
    },
    async schedule(senderId, draft, sendAt) {
      await throwOnErr(() =>
        emailClient.scheduleMessage(
          {
            draftID: draft.draftId,
            draftGeneration: draft.generation,
            send_time: sendAt,
            include_signature: false,
            source: SEQUENCE_SOURCE,
          },
          senderId
        )
      );
    },
    async cancel(senderId, draft) {
      const first = await cancelOnce(senderId, draft, draft.generation ?? 0);
      if (typeof first === 'string') return first;
      // The draft was edited in the composer; cancel it at its new generation.
      const second = await cancelOnce(senderId, draft, first.retry);
      if (typeof second === 'string') return second;
      throw new MarketingError('cancelKeepsChanging');
    },
    async scheduled(senderId) {
      const { ids, complete } = await listScheduled(senderId);
      return complete ? ids : undefined;
    },
    async inspect(senderId, steps) {
      // Only this inbox's sequence sends, pending or failed, never sent ones.
      const { ids: scheduled, complete } = await listScheduled(senderId);
      const now = Date.now();
      const issues: Record<string, DeliveryIssue> = {};
      const sent: string[] = [];
      const stalled: InspectedStep[] = [];
      for (const step of steps) {
        const due = new Date(step.sendAt).getTime();
        if (scheduled.has(step.draftId)) {
          if (due < now - STALLED_AFTER_MS) stalled.push(step);
          continue;
        }
        // A step still being scheduled may not be listed yet.
        if (!step.queued || !complete) continue;
        // Off the scheduler after its time: sent. Before it: deleted or sent elsewhere.
        if (due <= now) sent.push(step.draftId);
        else issues[step.draftId] = 'missing';
      }
      for (const step of stalled) issues[step.draftId] = 'stalled';
      const states = await Promise.all(
        stalled.slice(0, MAX_STATUS_READS).map(readDraftState)
      );
      for (const [index, state] of states.entries()) {
        if (state.kind !== 'found') continue;
        const { draftId } = stalled[index];
        if (state.status === 'failed') issues[draftId] = 'failed';
        else if (state.status === 'unconfirmed')
          issues[draftId] = 'unconfirmed';
      }
      const known = new Set(steps.map((step) => step.draftId));
      return {
        issues,
        sent,
        untracked: [...scheduled].filter((draftId) => !known.has(draftId)),
      };
    },
  };
}
