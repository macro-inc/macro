import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DictationController } from '../core/types';
import { clearNotesOnDraftChange } from './clear-on-draft-change';

function controller(): DictationController {
  return {
    phase: () => 'idle',
    active: () => false,
    volumeHistory: () => [],
    elapsedMs: () => 0,
    limitReached: () => false,
    message: () => 'No speech was detected. Try again.',
    messageTone: () => 'info',
    clearMessage: vi.fn(),
    label: () => 'Start dictation',
    disabled: () => false,
    start: vi.fn(async () => {}),
    confirm: async () => {},
    cancel: () => {},
  };
}

describe('clearNotesOnDraftChange', () => {
  it('clears the note when the draft text changes, from any composer', async () => {
    const editor = createEditor({
      onError: (error) => {
        throw error;
      },
    });
    editor.setRootElement(document.createElement('div'));
    const inner = controller();
    await createRoot(async (dispose) => {
      const dictation = clearNotesOnDraftChange(inner, () => editor);
      await dictation.start();
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode('typed'))
          );
        },
        { discrete: true }
      );
      expect(inner.clearMessage).toHaveBeenCalled();
      dispose();
    });
  });
});
