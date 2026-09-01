import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { invalidateSoupEntity } from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import type { ApiDraftInput } from '@service-email/generated/schemas';
import { prepareEmailBodyFromHtml } from './prepareEmailBody';

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
const claimedDraftIds = new Set<string>();

/** Claim an undo for this draft. Returns false if one is in flight or done. */
export function tryBeginUndoSend(draftId: string): boolean {
  if (claimedDraftIds.has(draftId)) return false;
  claimedDraftIds.add(draftId);
  return true;
}

/** Release a claim — after a failed undo, or when the draft is sent again. */
export function endUndoSend(draftId: string) {
  claimedDraftIds.delete(draftId);
}

/**
 * Unschedule with one retry on transient failures (network errors, 5xx from a
 * redeploy or proxy blip). Retrying is safe: the endpoint treats an
 * already-undone send as success. 400 (already sent — the undo window passed)
 * and 404 (not found) are definitive and not retried.
 */
export async function unscheduleWithRetry(
  draftId: string,
  linkId: string | undefined
) {
  const first = await emailClient.unscheduleMessage(
    { draftID: draftId },
    linkId
  );
  if (first.isOk()) return first;
  const definitive = first.error.some(
    (e) =>
      e.code === 'NOT_FOUND' ||
      (e.code === 'HTTP_ERROR' && e.message.includes('status: 400'))
  );
  if (definitive) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return emailClient.unscheduleMessage({ draftID: draftId }, linkId);
}

/**
 * The shared undo-send flow: claims the guard, unschedules with retry,
 * surfaces failures (including the definitive "already sent" 400), and on
 * success invalidates the previews then runs the surface-specific `onUndone`
 * work — cache edits, snapshot restore, navigation — before announcing the
 * cancellation. Callers keep only what genuinely differs per surface.
 */
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
  const saveResult = await emailClient.createDraft(
    { draft: { ...draft, body_html: prepared.bodyHtml } },
    linkId
  );
  if (saveResult.isErr()) {
    Telemetry.error(new Error('Failed to restore draft body after undo-send'));
  }
}
