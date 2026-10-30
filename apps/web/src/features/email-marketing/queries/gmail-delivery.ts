import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type { DraftRef, SequenceDelivery } from '../context/contracts';
import type { DeliveryIssue } from '../core/model';

type ResultErrors = { code: string; message: string }[];

function describe(errors: ResultErrors) {
  return errors.map((error) => error.message).join('; ');
}

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

/**
 * Read a draft's delivery state. The thread read carries send status; the
 * message read is a fallback for rows saved before thread ids were stored.
 */
async function readDraftState(draft: DraftRef): Promise<DraftState> {
  if (draft.threadId) {
    const thread = await emailClient.getThread({
      thread_id: draft.threadId,
      limit: 50,
    });
    if (thread.isOk()) {
      const message = thread.value.thread.messages.find(
        (item) => item.db_id === draft.draftId
      );
      if (!message) return { kind: 'gone' };
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
    if (thread.error.every((error) => error.code === 'NOT_FOUND'))
      return { kind: 'gone' };
  }
  const message = await emailClient.getMessage({ message_id: draft.draftId });
  if (message.isOk())
    return { kind: 'found', generation: message.value.draft_generation };
  if (message.error.every((error) => error.code === 'NOT_FOUND'))
    return { kind: 'gone' };
  return { kind: 'unknown' };
}

async function cancelOnce(
  senderId: string,
  draft: DraftRef,
  generation: number
): Promise<'canceled' | 'delivery_started' | { retry: number }> {
  const unscheduled = await emailClient.unscheduleMessage(
    { draftID: draft.draftId, draftGeneration: generation },
    senderId
  );
  // No schedule and no message both mean nothing is left to send.
  const removed =
    unscheduled.isOk() ||
    unscheduled.error.every((error) => error.code === 'NOT_FOUND');
  if (removed) {
    const deleted = await emailClient.deleteDraft(
      { id: draft.draftId, draftGeneration: generation },
      senderId
    );
    if (
      deleted.isOk() ||
      deleted.error.every((error) => error.code === 'NOT_FOUND')
    )
      return 'canceled';
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
): Promise<'canceled' | 'delivery_started' | { retry: number }> {
  const state = await readDraftState(draft);
  if (state.kind === 'gone') return 'canceled';
  if (state.kind === 'found') {
    if (state.sent || state.delivering) return 'delivery_started';
    if (state.generation !== undefined && state.generation !== generation)
      return { retry: state.generation };
  }
  throw new Error(`Could not cancel a scheduled email: ${reason}`);
}

export function createGmailSequenceDelivery(): SequenceDelivery {
  return {
    async createDraft(senderId, email, subject, body) {
      const result = await throwOnErr(() =>
        emailClient.createDraft(
          {
            draft: {
              subject,
              body_text: body,
              to: [{ email }],
              include_signature: false,
            },
          },
          senderId
        )
      );
      if (!result.draft.db_id)
        throw new Error('Gmail did not return a draft ID.');
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
      throw new Error(
        'Could not cancel a scheduled email because it keeps changing. Check Drafts > Scheduled.'
      );
    },
    async inspect(senderId, steps) {
      const scheduled = new Set<string>();
      for (let page = 0; page < MAX_SCHEDULED_PAGES; page++) {
        const result = await throwOnErr(() =>
          emailClient.getScheduledMessages(
            { offset: page * SCHEDULED_PAGE_SIZE, limit: SCHEDULED_PAGE_SIZE },
            senderId
          )
        );
        for (const message of result.messages) scheduled.add(message.db_id);
        if (result.messages.length < SCHEDULED_PAGE_SIZE) break;
      }
      const now = Date.now();
      const issues: Record<string, DeliveryIssue> = {};
      const stalled: (DraftRef & { sendAt: string })[] = [];
      for (const step of steps) {
        const due = new Date(step.sendAt).getTime();
        const queued = scheduled.has(step.draftId);
        if (queued && due < now - STALLED_AFTER_MS) stalled.push(step);
        // Removed from the scheduler before its time: deleted or sent elsewhere.
        else if (!queued && due > now) issues[step.draftId] = 'missing';
      }
      for (const [index, step] of stalled.entries()) {
        issues[step.draftId] = 'stalled';
        if (index >= MAX_STATUS_READS || !step.threadId) continue;
        const state = await readDraftState(step);
        if (state.kind !== 'found') continue;
        if (state.status === 'failed') issues[step.draftId] = 'failed';
        else if (state.status === 'unconfirmed')
          issues[step.draftId] = 'unconfirmed';
      }
      return issues;
    },
  };
}
