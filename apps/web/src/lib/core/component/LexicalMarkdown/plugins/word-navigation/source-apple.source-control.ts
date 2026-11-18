/** Isolated Source platform control; run with source-control.vitest.config.ts. */
import { afterAll, expect, test, vi } from 'vitest';

const previousPlatform = vi.hoisted(() => {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'platform');
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'MacIntel',
  });
  return previous;
});

import { registerRichText } from '@lexical/rich-text';
import {
  $createUserMentionNode,
  UserMentionNode,
} from '@macro-inc/lexical-core/nodes/UserMentionNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  IS_APPLE,
  MOVE_TO_END,
  MOVE_TO_START,
} from 'lexical';
import { wordNavigationPlugin } from './wordNavigationPlugin';

afterAll(() => {
  if (previousPlatform)
    Object.defineProperty(navigator, 'platform', previousPlatform);
  else Reflect.deleteProperty(navigator, 'platform');
});

test.each([false, true])(
  'Source Apple word interception declines Cmd-Left while real RichText retains its line-edge fallback (rich=%s)',
  (rich) => {
    expect(IS_APPLE).toBe(true);
    const editor = createEditor({
      namespace: 'source-apple-word-start',
      nodes: [UserMentionNode],
      onError(error) {
        throw error;
      },
    });
    const removeRich = rich ? registerRichText(editor) : () => {};
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
          text.select(6, 6);
          const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            metaKey: true,
            cancelable: true,
          });
          expect(editor.dispatchCommand(MOVE_TO_START, event)).toBe(rich);
          expect(event.defaultPrevented).toBe(rich);
          const selection = $getSelection();
          if (!$isRangeSelection(selection))
            throw new Error('Expected actual Source range');
          expect(selection.anchor).toMatchObject(
            rich
              ? { key: paragraph.getKey(), type: 'element', offset: 0 }
              : { key: text.getKey(), type: 'text', offset: 6 }
          );
          expect(selection.focus).toEqual(selection.anchor);
        },
        { discrete: true }
      );
    } finally {
      removeWord();
      removeRich();
    }
  }
);

test.each([false, true])(
  'Source Apple word interception declines Cmd-Right while real RichText retains its line-edge fallback (rich=%s)',
  (rich) => {
    expect(IS_APPLE).toBe(true);
    const editor = createEditor({
      namespace: 'source-apple-word-end',
      nodes: [UserMentionNode],
      onError(error) {
        throw error;
      },
    });
    const removeRich = rich ? registerRichText(editor) : () => {};
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
          paragraph.select(0, 0);
          const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            metaKey: true,
            cancelable: true,
          });
          expect(editor.dispatchCommand(MOVE_TO_END, event)).toBe(rich);
          expect(event.defaultPrevented).toBe(rich);
          const selection = $getSelection();
          if (!$isRangeSelection(selection))
            throw new Error('Expected actual Source range');
          expect(selection.anchor).toMatchObject(
            rich
              ? { key: text.getKey(), type: 'text', offset: 12 }
              : { key: paragraph.getKey(), type: 'element', offset: 0 }
          );
          expect(selection.focus).toEqual(selection.anchor);
        },
        { discrete: true }
      );
    } finally {
      removeWord();
      removeRich();
    }
  }
);
