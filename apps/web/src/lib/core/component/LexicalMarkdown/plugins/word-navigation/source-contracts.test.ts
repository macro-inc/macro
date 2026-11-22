import { $createCodeNode, CodeHighlightNode, CodeNode } from '@lexical/code';
import { registerRichText } from '@lexical/rich-text';
import {
  $createCustomCodeNode,
  CustomCodeNode,
} from '@macro-inc/lexical-core/nodes/CustomCodeNode';
import {
  $createUserMentionNode,
  UserMentionNode,
} from '@macro-inc/lexical-core/nodes/UserMentionNode';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  createEditor,
  IS_APPLE,
  MOVE_TO_END,
  MOVE_TO_START,
} from 'lexical';
import { expect, test } from 'vitest';
import { wordNavigationPlugin } from './wordNavigationPlugin';

function editorWithWord(rich = false) {
  const editor = createEditor({
    namespace: 'source-word-contracts',
    nodes: [UserMentionNode, CodeNode, CodeHighlightNode, CustomCodeNode],
    onError(error) {
      throw error;
    },
  });
  const removeRich = rich ? registerRichText(editor) : () => {};
  const removeWord = wordNavigationPlugin()(editor);
  return {
    editor,
    close() {
      removeWord();
      removeRich();
    },
  };
}
function nodes() {
  const paragraph = $createParagraphNode();
  const mention = $createUserMentionNode({
    userId: 'person',
    email: 'person@example.com',
    displayName: 'Person',
  });
  const text = $createTextNode(' after words');
  paragraph.append(mention, text);
  $getRoot().clear().append(paragraph);
  return { paragraph, mention, text };
}

test.each([false, true])(
  'Source collapsed Ctrl-Left with shift=%s at text0 preserves the correct anchor and prevents default',
  (shiftKey) => {
    expect(IS_APPLE).toBe(false);
    const fixture = editorWithWord(true);
    try {
      fixture.editor.update(
        () => {
          const { paragraph, text } = nodes();
          text.select(0, 0);
          const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: true,
            shiftKey,
            cancelable: true,
          });
          expect(fixture.editor.dispatchCommand(MOVE_TO_START, event)).toBe(
            true
          );
          expect(event.defaultPrevented).toBe(true);
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) throw new Error('Source range');
          expect(selection.focus).toMatchObject({
            key: paragraph.getKey(),
            type: 'element',
            offset: 0,
          });
          expect(selection.anchor).toMatchObject(
            shiftKey
              ? { key: text.getKey(), type: 'text', offset: 0 }
              : { key: paragraph.getKey(), type: 'element', offset: 0 }
          );
        },
        { discrete: true }
      );
    } finally {
      fixture.close();
    }
  }
);

test('Source expanded Ctrl-Left suppresses the lower block-edge helper without preventing browser default', () => {
  expect(IS_APPLE).toBe(false);
  const fixture = editorWithWord(true);
  try {
    fixture.editor.update(
      () => {
        const { text } = nodes();
        text.select(1, 6);
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          ctrlKey: true,
          shiftKey: true,
          cancelable: true,
        });
        expect(fixture.editor.dispatchCommand(MOVE_TO_START, event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('Source range');
        expect(selection.anchor).toMatchObject({
          key: text.getKey(),
          type: 'text',
          offset: 1,
        });
        expect(selection.focus).toMatchObject({
          key: text.getKey(),
          type: 'text',
          offset: 6,
        });
      },
      { discrete: true }
    );
  } finally {
    fixture.close();
  }
});

test.each([false, true])(
  'Source word interceptor rejects either endpoint in the actual Code class (custom=%s)',
  (custom) => {
    expect(IS_APPLE).toBe(false);
    const fixture = editorWithWord();
    try {
      fixture.editor.update(
        () => {
          const { paragraph, text } = nodes();
          const code = custom
            ? $createCustomCodeNode('plain')
            : $createCodeNode('plain');
          const codeText = $createTextNode('code');
          code.append(codeText);
          $getRoot().append(code);
          for (const start of [true, false]) {
            const selection = $createRangeSelection();
            if (start) {
              selection.anchor.set(codeText.getKey(), 0, 'text');
              selection.focus.set(text.getKey(), 0, 'text');
            } else {
              selection.anchor.set(paragraph.getKey(), 0, 'element');
              selection.focus.set(codeText.getKey(), 0, 'text');
            }
            $setSelection(selection);
            const event = new KeyboardEvent('keydown', {
              key: start ? 'ArrowLeft' : 'ArrowRight',
              ctrlKey: true,
              cancelable: true,
            });
            expect(
              fixture.editor.dispatchCommand(
                start ? MOVE_TO_START : MOVE_TO_END,
                event
              )
            ).toBe(false);
            expect(event.defaultPrevented).toBe(false);
            expect($getSelection()).toBe(selection);
          }
        },
        { discrete: true }
      );
    } finally {
      fixture.close();
    }
  }
);

test('Source word interceptor declines null and actual mention NodeSelections', () => {
  expect(IS_APPLE).toBe(false);
  const fixture = editorWithWord();
  try {
    fixture.editor.update(
      () => {
        const { mention } = nodes();
        const node = $createNodeSelection();
        node.add(mention.getKey());
        for (const selection of [null, node]) {
          $setSelection(selection);
          for (const start of [true, false]) {
            const event = new KeyboardEvent('keydown', {
              key: start ? 'ArrowLeft' : 'ArrowRight',
              ctrlKey: true,
              cancelable: true,
            });
            expect(
              fixture.editor.dispatchCommand(
                start ? MOVE_TO_START : MOVE_TO_END,
                event
              )
            ).toBe(false);
            expect(event.defaultPrevented).toBe(false);
            expect($getSelection()).toBe(selection);
          }
        }
      },
      { discrete: true }
    );
  } finally {
    fixture.close();
  }
});
