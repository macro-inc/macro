import { registerRichText } from '@lexical/rich-text';
import {
  $createUserMentionNode,
  UserMentionNode,
} from '@macro-inc/lexical-core/nodes/UserMentionNode';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  MOVE_TO_END,
  MOVE_TO_START,
} from 'lexical';
import { beforeAll, expect, test } from 'vitest';
import { installNativeMarkdownOverlays } from '../../editing/installNativeMarkdownOverlays';
import { wordNavigationPlugin } from './wordNavigationPlugin';

beforeAll(initializeNativeSurfaceTests);

test('Source Ctrl-Left from text zero after a leading actual user mention selects the paragraph element start', () => {
  const editor = createEditor({
    namespace: 'source-word-start',
    nodes: [UserMentionNode],
    onError(error) {
      throw error;
    },
  });
  const removeRich = registerRichText(editor);
  const removeWord = wordNavigationPlugin()(editor);
  try {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode(' after words');
        paragraph.append(
          $createUserMentionNode({
            userId: 'person',
            email: 'person@example.com',
            displayName: 'Person',
          }),
          text
        );
        $getRoot().clear().append(paragraph);
        text.select(0, 0);
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          ctrlKey: true,
          cancelable: true,
        });
        expect(editor.dispatchCommand(MOVE_TO_START, event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        const selection = $getSelection();
        if (!$isRangeSelection(selection))
          throw new Error('Expected actual Source range');
        expect(selection.anchor).toMatchObject({
          key: paragraph.getKey(),
          type: 'element',
          offset: 0,
        });
        expect(selection.focus).toEqual(selection.anchor);
      },
      { discrete: true }
    );
  } finally {
    removeWord();
    removeRich();
  }
});

test('mounted native Ctrl-Left from text zero after a leading actual user mention selects the paragraph element start', () => {
  const fixture = nativeSurface();
  // Decoration supplies only a DOM host; model classification and navigation
  // remain the actual Macro UserMention and production view/event pipeline.
  registerMacroDecoratorViews(fixture.view.registry, {
    'user-mention': () => null,
  });
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'user-mention',
                  userId: 'person',
                  email: 'person@example.com',
                  displayName: 'Person',
                },
                { type: 'text', text: ' after words' },
              ],
            },
          ],
        },
      })
    );
    const text = [...fixture.view.mirror.values()].find(
      (node) => node.kind === 'text' && node.text === ' after words'
    );
    if (!text || text.parent === null)
      throw new Error('Missing actual native text');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, type: 'text', offset: 0 },
      focus: { key: text.key, type: 'text', offset: 0 },
    });
    fixture.root.focus();
    const dom = fixture.view.getElementByKey(text.key)?.firstChild;
    if (!dom) throw new Error('Missing actual native text DOM');
    const range = document.createRange();
    range.setStart(dom, 0);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      keyCode: 37,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fixture.root.dispatchEvent(event);
    const selection = fixture.view.selection().selection;
    expect(selection.kind).toBe('range');
    if (selection.kind !== 'range')
      throw new Error('Expected actual native range');
    expect(selection.anchor).toEqual({
      key: text.parent,
      type: 'element',
      offset: 0,
    });
    expect(selection.focus).toEqual(selection.anchor);
    expect(event.defaultPrevented).toBe(true);
  } finally {
    installation.dispose();
    fixture.close();
  }
});

test('Source Ctrl-Right before a leading actual user mention consumes without moving the model to the block end', () => {
  const editor = createEditor({
    namespace: 'source-word-end',
    nodes: [UserMentionNode],
    onError(error) {
      throw error;
    },
  });
  const removeRich = registerRichText(editor);
  const removeWord = wordNavigationPlugin()(editor);
  try {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createUserMentionNode({
            userId: 'person',
            email: 'person@example.com',
            displayName: 'Person',
          }),
          $createTextNode(' after words')
        );
        $getRoot().clear().append(paragraph);
        paragraph.select(0, 0);
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          ctrlKey: true,
          cancelable: true,
        });
        expect(editor.dispatchCommand(MOVE_TO_END, event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
        const selection = $getSelection();
        if (!$isRangeSelection(selection))
          throw new Error('Expected actual Source range');
        expect(selection.anchor).toMatchObject({
          key: paragraph.getKey(),
          type: 'element',
          offset: 0,
        });
        expect(selection.focus).toEqual(selection.anchor);
      },
      { discrete: true }
    );
  } finally {
    removeWord();
    removeRich();
  }
});

test('mounted native Ctrl-Right before a leading actual user mention preserves its model element point for browser word motion', () => {
  const fixture = nativeSurface();
  registerMacroDecoratorViews(fixture.view.registry, {
    'user-mention': () => null,
  });
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'user-mention',
                  userId: 'person',
                  email: 'person@example.com',
                  displayName: 'Person',
                },
                { type: 'text', text: ' after words' },
              ],
            },
          ],
        },
      })
    );
    const paragraph = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'paragraph'
    );
    if (!paragraph) throw new Error('Missing actual native paragraph');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, type: 'element', offset: 0 },
      focus: { key: paragraph.key, type: 'element', offset: 0 },
    });
    fixture.root.focus();
    const dom = fixture.view.getElementByKey(paragraph.key);
    if (!dom) throw new Error('Missing actual native paragraph DOM');
    const range = document.createRange();
    range.setStart(dom, 0);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      keyCode: 39,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fixture.root.dispatchEvent(event);
    const selection = fixture.view.selection().selection;
    expect(selection.kind).toBe('range');
    if (selection.kind !== 'range')
      throw new Error('Expected actual native range');
    expect(selection.anchor).toEqual({
      key: paragraph.key,
      type: 'element',
      offset: 0,
    });
    expect(selection.focus).toEqual(selection.anchor);
    expect(event.defaultPrevented).toBe(false);
  } finally {
    installation.dispose();
    fixture.close();
  }
});
