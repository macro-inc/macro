import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  createEditor,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearComposer } from '../utils/clear-composer';

vi.mock('@solid-primitives/platform', () => ({ isIOS: true }));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setup() {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  root.tabIndex = 0;
  document.body.append(root);
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(root);
  const history = createEmptyHistoryState();
  const unregisterHistory = registerHistory(editor, history, 400);
  editor.update(
    () => {
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Sent text'))
      );
    },
    { discrete: true }
  );
  // This is the selection-clearing update used by the Markdown controls.
  const clear = vi.fn(() => {
    editor.update(() => {
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      $getRoot().clear().append($createParagraphNode());
      $setSelection(null);
    });
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  });
  return {
    root,
    editor,
    clear,
    history,
    dispose: () => {
      unregisterHistory();
      editor.setRootElement(null);
    },
  };
}

describe('iOS composer clearing', () => {
  it('restores the caret without scrolling the viewport', async () => {
    const f = setup();
    try {
      f.root.focus();
      // The composer lies below the viewport while the keyboard is resizing.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, window.innerHeight + 100, 300, 20)
      );
      const scrollBy = vi
        .spyOn(window, 'scrollBy')
        .mockImplementation(() => {});
      clearComposer(f.editor, f.clear);
      await Promise.resolve();
      expect(document.activeElement).toBe(f.root);
      f.editor
        .getEditorState()
        .read(() => expect($getSelection()).not.toBeNull());
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });

  it('cannot undo a send back to the sent message', async () => {
    const f = setup();
    try {
      f.editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append($createTextNode('Edited sent text'))
            );
          $getRoot().selectEnd();
        },
        { discrete: true, tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] }
      );
      expect(f.history.undoStack.length).toBeGreaterThan(0);
      f.root.focus();
      clearComposer(f.editor, f.clear);
      await Promise.resolve();
      expect(f.history.undoStack).toEqual([]);
      expect(f.history.redoStack).toEqual([]);
      f.editor.dispatchCommand(UNDO_COMMAND, undefined);
      await Promise.resolve();
      expect(f.root.textContent).toBe('');
    } finally {
      f.dispose();
    }
  });

  it('ends the editing session and clears before restoring focus in the same task', async () => {
    const f = setup();
    try {
      f.root.focus();
      const atBlur: string[] = [];
      f.root.addEventListener('blur', () =>
        atBlur.push(f.root.textContent ?? '')
      );
      clearComposer(f.editor, f.clear);
      expect(atBlur).toEqual(['Sent text']);
      expect(f.clear).toHaveBeenCalledOnce();
      expect(f.root.textContent).toBe('');
      expect(document.activeElement).toBe(f.root);
      await Promise.resolve();
      expect(document.activeElement).toBe(f.root);
      f.editor
        .getEditorState()
        .read(() => expect($getSelection()).not.toBeNull());
    } finally {
      f.dispose();
    }
  });

  it('does not steal focus back after the user has left the composer', async () => {
    const f = setup();
    try {
      const other = document.createElement('input');
      document.body.append(other);
      other.focus();
      clearComposer(f.editor, f.clear);
      await Promise.resolve();
      expect(f.clear).toHaveBeenCalledOnce();
      expect(f.root.textContent).toBe('');
      expect(document.activeElement).toBe(other);
    } finally {
      f.dispose();
    }
  });
});
