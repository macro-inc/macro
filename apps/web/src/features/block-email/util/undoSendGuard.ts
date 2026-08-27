import { emailClient } from '@service-email/client';

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
