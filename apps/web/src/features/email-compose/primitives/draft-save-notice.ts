import { onCleanup } from 'solid-js';
import type { EmailComposeFeedback } from '../context/compose-capabilities';

/**
 * One warning per local-save failure episode, shared by both composers. The
 * warning outlives the composer: closing it flushes the unsaved edit once more,
 * and only a successful write may dismiss the warning.
 */
export function createDraftSaveNotice(
  feedback: EmailComposeFeedback['feedback']
) {
  let failed = false;
  let notice: number | undefined;
  const clear = () => {
    if (notice !== undefined) feedback.dismiss(notice);
    notice = undefined;
    failed = false;
  };
  onCleanup(() => {
    if (!failed) clear();
  });
  return {
    onLocalError(error: unknown) {
      if (failed) return;
      failed = true;
      notice = feedback.failure('Draft could not be saved on this device', {
        subtext: String(error),
        persistent: true,
      });
    },
    onLocalSaved: clear,
  };
}
