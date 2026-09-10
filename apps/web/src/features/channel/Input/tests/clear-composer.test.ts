import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  createEditor,
  SKIP_DOM_SELECTION_TAG,
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
  const clear = vi.fn(() =>
    editor.update(() => {
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      $getRoot().clear().append($createParagraphNode());
      $setSelection(null);
    })
  );
  return { root, editor, clear, dispose: () => editor.setRootElement(null) };
}

describe('iOS composer clearing', () => {
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
