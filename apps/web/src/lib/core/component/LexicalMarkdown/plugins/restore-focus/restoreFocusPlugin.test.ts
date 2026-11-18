import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  createEditor,
} from 'lexical';
import { expect, it, vi } from 'vitest';
import { restoreFocusPlugin } from './restoreFocusPlugin';

it('restores the root selection without stealing focus from embedded controls', () => {
  const editor = createEditor();
  const root = document.createElement('div');
  const embed = document.createElement('div');
  const control = document.createElement('button');
  embed.contentEditable = 'false';
  embed.append(control);
  document.body.append(root);
  editor.setRootElement(root);
  root.append(embed);
  const dispose = restoreFocusPlugin()(editor);
  const focus = vi.spyOn(editor, 'focus').mockImplementation(() => {});
  try {
    control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
    root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(focus).toHaveBeenCalledOnce();
  } finally {
    focus.mockRestore();
    dispose();
    editor.setRootElement(null);
    root.remove();
  }
});

/** A connected editor holding `Seed`, with no selection, and the DOM caret at its start as native focus leaves it. */
function seededEditor() {
  const editor = createEditor();
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode('Seed')));
      $setSelection(null);
    },
    { discrete: true }
  );
  const text = root.querySelector('span')?.firstChild;
  if (text) window.getSelection()?.collapse(text, 0);
  // editor.read commits pending updates first.
  const caret = () =>
    editor.read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? selection.anchor.offset : undefined;
    });
  const cleanup = () => {
    editor.setRootElement(null);
    root.remove();
  };
  return { editor, root, caret, cleanup };
}

it.each([
  [undefined, 0],
  ['rootEnd', 'Seed'.length],
] as const)(
  'applies the default selection (%s) over the native caret',
  (option, expected) => {
    const { editor, root, caret, cleanup } = seededEditor();
    const dispose = restoreFocusPlugin(option)(editor);
    try {
      root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(caret()).toBe(expected);
    } finally {
      dispose();
      cleanup();
    }
  }
);

it('keeps the selection the editor already had', () => {
  const { editor, root, caret, cleanup } = seededEditor();
  editor.update(
    () => {
      const text = $getRoot().getFirstDescendant();
      if ($isTextNode(text)) text.select(2, 2);
    },
    { discrete: true }
  );
  window.getSelection()?.removeAllRanges();
  const dispose = restoreFocusPlugin('rootEnd')(editor);
  try {
    root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(caret()).toBe(2);
  } finally {
    dispose();
    cleanup();
  }
});
