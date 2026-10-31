import { createEditor } from 'lexical';
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

it.each([
  [undefined, 'rootStart'],
  ['rootEnd', 'rootEnd'],
] as const)(
  'falls back to the configured selection (%s)',
  (option, expected) => {
    const editor = createEditor();
    const root = document.createElement('div');
    document.body.append(root);
    editor.setRootElement(root);
    const dispose = restoreFocusPlugin(option)(editor);
    const focus = vi.spyOn(editor, 'focus').mockImplementation(() => {});
    try {
      root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(focus).toHaveBeenCalledWith(undefined, {
        defaultSelection: expected,
      });
    } finally {
      focus.mockRestore();
      dispose();
      editor.setRootElement(null);
      root.remove();
    }
  }
);
