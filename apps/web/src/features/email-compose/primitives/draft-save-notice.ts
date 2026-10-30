import { onCleanup } from 'solid-js';
import type { EmailComposeFeedback } from '../context/compose-capabilities';

/**
 * One warning per local-save failure episode, shared by both composers.
 * Closing the composer dismisses it. A write that fails after closing, such as
 * the failed edit it writes once more, shows a brief warning instead: nothing
 * is left to dismiss a persistent one.
 */
export function createDraftSaveNotice(
  feedback: EmailComposeFeedback['feedback']
) {
  let failed = false;
  let notice: number | undefined;
  let disposed = false;
  const clear = () => {
    if (notice !== undefined) feedback.dismiss(notice);
    notice = undefined;
    failed = false;
  };
  onCleanup(() => {
    disposed = true;
    clear();
  });
  return {
    onLocalError(error: unknown) {
      if (failed) return;
      failed = true;
      notice = feedback.failure('Draft could not be saved on this device', {
        subtext: String(error),
        persistent: !disposed,
      });
    },
    onLocalSaved: clear,
  };
}
