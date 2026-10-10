import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import {
  restoreEmailDraft,
  unscheduleEmailMessage,
} from '@queries/email/integration';
import { emailKeys } from '@queries/email/keys';
import {
  cancelEmailSendQueued,
  EmailSendCancellationTooLate,
  EmailSendDeliveryUnconfirmed,
  emailSendLocked,
  readEmailSendIntents,
  restoreCancelledEmailSend,
} from '@queries/email/send-queue';
import { invalidateSoupEntity } from '@queries/soup/cache';
import type { ApiDraftInput } from '@service-email/generated/schemas';
import { prepareEmailBodyFromHtml } from './primitives/prepare-email-body';
import { endUndoSend, tryBeginUndoSend } from './primitives/undo-send-claim';

/**
 * Guards undo-send against duplicate invocations. The undo toast stays
 * clickable during its dismiss animation, so a double-click fires undoSend
 * twice; the second unschedule 404s (the scheduled row is already gone) and
 * flashes a false "Failed to undo send".
 *
 * An id stays claimed after a successful undo so late clicks stay inert; a
 * failed undo releases it (retry allowed), and a new send of the same draft
 * releases it to open the next undo cycle.
 */
/**
 * Unschedule with one retry on transient failures (network errors, 5xx from a
 * redeploy or proxy blip). Retrying is safe: the endpoint treats an
 * already-undone send as success. 400 (already sent — the undo window passed)
 * and 404 (not found) are definitive and not retried.
 */
async function unscheduleWithRetry(
  draftId: string,
  linkId: string | undefined
) {
  const first = await unscheduleEmailMessage({ draftID: draftId }, linkId);
  if (first.isOk()) return first;
  const definitive = first.error.some(
    (e) =>
      e.code === 'NOT_FOUND' ||
      (e.code === 'HTTP_ERROR' && e.message.includes('status: 400'))
  );
  if (definitive) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return unscheduleEmailMessage({ draftID: draftId }, linkId);
}

/** Durable undo survives navigation and restores only confirmed cancellations. */
export async function runQueuedUndoSend(options: {
  draftId: string;
  attemptId: string;
  onUndone: () => Promise<void> | void;
}): Promise<void> {
  const { draftId, attemptId } = options;
  if (!tryBeginUndoSend(draftId)) return;
  try {
    const intent = (await readEmailSendIntents()).find(
      (row) => row.uuid === attemptId
    );
    if (!intent) throw new Error('This send is no longer available to undo');
    const updated = await cancelEmailSendQueued(intent);
    if (emailSendLocked(updated)) {
      endUndoSend(draftId);
      toast.alert('Cancellation pending — waiting for confirmation');
      return;
    }
    await restoreCancelledEmailSend(updated);
    await options.onUndone();
    toast.success('Send cancelled');
  } catch (error) {
    endUndoSend(draftId);
    Telemetry.error(
      error instanceof Error ? error : new Error('Failed to undo send')
    );
    toast.failure(
      error instanceof EmailSendDeliveryUnconfirmed
        ? error.message
        : error instanceof EmailSendCancellationTooLate
          ? 'Too late to undo — delivery has already started'
          : 'Failed to undo send'
    );
  }
}

/** Unschedules legacy sends, then restores the composing surface with feedback. */
export async function runUndoSend(options: {
  draftId: string;
  /** The X-Email-Link-Id header value the send itself used. */
  linkId: string | undefined;
  onUndone: () => Promise<void> | void;
}): Promise<void> {
  const { draftId, linkId } = options;
  if (!tryBeginUndoSend(draftId)) return;
  try {
    const result = await unscheduleWithRetry(draftId, linkId);
    // A non-2xx response comes back as an Err Result (it doesn't throw), so
    // bail before reverting the send appearance in the UI.
    if (result.isErr()) {
      endUndoSend(draftId);
      Telemetry.error(
        new Error(
          `Failed to undo send for draft ${draftId}: ${result.error
            .map((e) => `${e.code}: ${e.message}`)
            .join(', ')}`
        )
      );
      // 400 is the backend's "already sent" — the undo window has passed.
      const alreadySent = result.error.some(
        (e) => e.code === 'HTTP_ERROR' && e.message.includes('status: 400')
      );
      toast.failure(
        alreadySent
          ? 'Too late to undo — the email was already sent'
          : 'Failed to undo send'
      );
      return;
    }
    queryClient.invalidateQueries({
      queryKey: emailKeys.previews._def,
    });

    await options.onUndone();

    toast.success('Send cancelled');
    invalidateSoupEntity(draftId);
  } catch (e) {
    endUndoSend(draftId);
    Telemetry.error(
      e instanceof Error
        ? e
        : new Error(`Failed to undo send for draft ${draftId}`)
    );
    toast.failure('Failed to undo send');
  }
}

/**
 * Overwrites the server-side draft with the pre-send content — the
 * unscheduled message still carries the sent body (appended reply chain /
 * watermark and injected signature baked in). A failure is non-fatal: the
 * composer restores from its snapshot either way, and the next draft
 * autosave overwrites the stale body.
 */
export async function restoreDraftBodyAfterUndo(
  draft: Omit<ApiDraftInput, 'body_html'>,
  bodyHtml: string,
  linkId: string | undefined
): Promise<void> {
  const prepared = prepareEmailBodyFromHtml(bodyHtml);
  const saveResult = await restoreEmailDraft(
    { draft: { ...draft, body_html: prepared.bodyHtml } },
    linkId
  );
  if (saveResult.isErr()) {
    Telemetry.error(new Error('Failed to restore draft body after undo-send'));
  }
}
