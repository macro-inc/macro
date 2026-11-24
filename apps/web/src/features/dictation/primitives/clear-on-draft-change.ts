import type { LexicalEditor } from 'lexical';
import { onCleanup } from 'solid-js';
import type { DictationController } from '../core/types';

/**
 * Clear the note under a composer (no speech, a capture failure) once its
 * draft text changes, in every composer that dictates. The editor exists by
 * the time dictation first starts, so it is watched from then on.
 */
export function clearNotesOnDraftChange(
  dictation: DictationController,
  editor: () => LexicalEditor
): DictationController {
  let stopWatching: (() => void) | undefined;
  onCleanup(() => stopWatching?.());
  return {
    ...dictation,
    start: () => {
      stopWatching ??= editor().registerTextContentListener(() =>
        dictation.clearMessage()
      );
      return dictation.start();
    },
  };
}
