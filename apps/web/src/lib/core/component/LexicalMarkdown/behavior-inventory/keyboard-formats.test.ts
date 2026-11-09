import { $isListNode, registerList } from '@lexical/list';
import { registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  KEY_DOWN_COMMAND,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  DefaultShortcuts,
  keyboardShortcutsPlugin,
  ListAndQuoteShortcuts,
} from '../plugins/keyboard-shortcuts/keyboardShortcutsPlugin';
import { nodeTransformPlugin } from '../plugins/node-transform/nodeTransformPlugin';
import { behaviorEditor } from './editor';

const PLATFORM = vi.hoisted(() => ({ mac: false }));
vi.mock('@core/constant/isMac', () => ({
  get IS_MAC() {
    return PLATFORM.mac;
  },
}));

for (const platform of ['Mac', 'Windows', 'Linux']) {
  describe(`${platform} editor formatting shortcuts`, () => {
    for (const correctModifier of [true, false]) {
      it.each([
        { code: 'KeyX', format: 'strikethrough', shiftKey: true },
        { code: 'KeyE', format: 'code', shiftKey: false },
        { code: 'KeyH', format: 'highlight', shiftKey: false },
      ] as const)(
        `$code changes selected text only with the platform modifier (correct=${correctModifier})`,
        ({ code, format, shiftKey }) => {
          PLATFORM.mac = platform === 'Mac';
          const { editor } = behaviorEditor(
            registerRichText,
            keyboardShortcutsPlugin({ shortcuts: DefaultShortcuts })
          );
          const metaKey = PLATFORM.mac === correctModifier;
          const event = new KeyboardEvent('keydown', {
            code,
            shiftKey,
            metaKey,
            ctrlKey: !metaKey,
            cancelable: true,
          });
          editor.update(
            () => {
              const text = $createTextNode('text');
              $getRoot().append($createParagraphNode().append(text));
              text.select(0, 4);
              editor.dispatchCommand(KEY_DOWN_COMMAND, event);
            },
            { discrete: true }
          );
          expect(event.defaultPrevented).toBe(correctModifier);
          editor.read(() => {
            const text = $getRoot().getFirstDescendant();
            expect($isTextNode(text) && text.hasFormat(format)).toBe(
              correctModifier
            );
            expect($getRoot().getTextContent()).toBe('text');
          });
        }
      );
    }

    for (const shiftKey of [true, false]) {
      it.each([
        { code: 'Digit7', type: 'number' },
        { code: 'Digit8', type: 'bullet' },
        { code: 'Digit9', type: 'quote' },
      ] as const)(
        `$code transforms the actual block only with Shift (shift=${shiftKey})`,
        ({ code, type }) => {
          PLATFORM.mac = platform === 'Mac';
          const { editor } = behaviorEditor(
            registerRichText,
            registerList,
            nodeTransformPlugin(),
            keyboardShortcutsPlugin({ shortcuts: ListAndQuoteShortcuts })
          );
          const event = new KeyboardEvent('keydown', {
            code,
            shiftKey,
            metaKey: PLATFORM.mac,
            ctrlKey: !PLATFORM.mac,
            cancelable: true,
          });
          editor.update(
            () => {
              const text = $createTextNode('retained');
              $getRoot().append($createParagraphNode().append(text));
              text.select(0, 8);
              editor.dispatchCommand(KEY_DOWN_COMMAND, event);
            },
            { discrete: true }
          );
          expect(event.defaultPrevented).toBe(shiftKey);
          editor.read(() => {
            const block = $getRoot().getFirstChild();
            expect(block?.getTextContent()).toBe('retained');
            if (!shiftKey) expect(block?.getType()).toBe('paragraph');
            else if (type === 'quote') expect(block?.getType()).toBe('quote');
            else expect($isListNode(block) && block.getListType()).toBe(type);
          });
        }
      );
    }
  });
}
