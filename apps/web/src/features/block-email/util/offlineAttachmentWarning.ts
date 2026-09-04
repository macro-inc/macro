import { deviceLooksOffline } from '@core/util/connectivity';
import { confirmDialog } from '@ui';
import type { Owner } from 'solid-js';

/**
 * Attachments cannot be added while offline: a queued draft save durably
 * carries only the draft's text, while attached file bytes live solely in
 * the open composer's memory and upload only on a later save that commits.
 * Rather than accept an attachment that can silently miss the draft, refuse
 * at attach time.
 *
 * Resolves `true` when attaching may proceed (device looks online);
 * otherwise shows a blocking notice and resolves `false`. `owner` should be
 * captured with `getOwner()` during component setup — attach handlers run
 * as event handlers, which have none of their own.
 */
export async function ensureOnlineToAttach(
  owner: Owner | null
): Promise<boolean> {
  if (!deviceLooksOffline()) return true;
  await confirmDialog(
    {
      title: "You're offline",
      body: "Attachments can't be added while you're offline. Reconnect and try again.",
      confirmLabel: 'OK',
      hideCancel: true,
    },
    { owner }
  );
  return false;
}
