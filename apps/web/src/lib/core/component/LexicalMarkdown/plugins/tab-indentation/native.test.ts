import { registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_TAB_COMMAND,
} from 'lexical';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { installNativeMarkdownOverlays } from '../../editing/installNativeMarkdownOverlays';
import {
  initializeNativeKeyboardSurface,
  nativeKeyboardSurface,
} from '../../editing/test/native-keyboard-surface';
import { tabIndentationPlugin } from './tabIndentationPlugin';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());

test('mounted Markdown Tab indents an empty paragraph without inserting a TabNode and Shift-Tab reverses it', async () => {
  const fixture = nativeKeyboardSurface();
  fixture.port.setState(
    JSON.stringify({
      root: { type: 'root', children: [{ type: 'paragraph', children: [] }] },
    })
  );
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  const paragraph = fixture.root.firstElementChild;
  if (!paragraph) throw new Error('Missing actual native paragraph');
  fixture.root.focus();
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  const key = (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    fixture.root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  try {
    key();
    const state = JSON.parse(fixture.session.serializedState());
    expect(state.root.children[0].children).toEqual([]);
    expect(state.root.children[0].indent).toBe(1);
    const selection = fixture.view.selection().selection;
    expect(selection.kind).toBe('range');
    if (selection.kind !== 'range') throw new Error('Missing range');
    expect(selection.anchor).toMatchObject({ type: 'element', offset: 0 });
    expect(selection.focus).toEqual(selection.anchor);
    key();
    expect(
      JSON.parse(fixture.session.serializedState()).root.children[0].indent
    ).toBe(1);
    key(true);
    const restored = JSON.parse(fixture.session.serializedState());
    expect(restored.root.children[0].children).toEqual([]);
    expect(restored.root.children[0].indent).toBe(0);
    installation.dispose();
    key();
    expect(
      JSON.parse(fixture.session.serializedState()).root.children[0].children[0]
        .type
    ).toBe('tab');
  } finally {
    installation.dispose();
    await fixture.close();
  }
});

test('Source Tab indents an empty paragraph once, preserves element offset zero and outdents on Shift-Tab', () => {
  const { editor } = behaviorEditor(tabIndentationPlugin(), registerRichText);
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.select(0, 0);
      for (const [shiftKey, indent] of [
        [false, 1],
        [false, 1],
        [true, 0],
      ] as const) {
        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey,
          cancelable: true,
        });
        expect(editor.dispatchCommand(KEY_TAB_COMMAND, event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(paragraph.getChildren()).toEqual([]);
        expect(paragraph.getIndent()).toBe(indent);
        const selection = $getSelection();
        expect($isRangeSelection(selection)).toBe(true);
        if (!$isRangeSelection(selection))
          throw new Error('Missing Source range');
        expect(selection.anchor.type).toBe('element');
        expect(selection.anchor.offset).toBe(0);
        expect(selection.focus).toEqual(selection.anchor);
      }
    },
    { discrete: true }
  );
});
