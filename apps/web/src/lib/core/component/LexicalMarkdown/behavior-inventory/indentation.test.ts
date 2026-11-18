import { $createCodeNode } from '@lexical/code';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_LOW,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { tabIndentationPlugin } from '../plugins/tab-indentation/tabIndentationPlugin';
import { behaviorEditor } from './editor';

describe('bounded paragraph indentation', () => {
  it.each([0, 1, 2, 3])(
    'allows only one level beyond a previous sibling at indent %s',
    (depth) => {
      const { editor } = behaviorEditor(tabIndentationPlugin());
      editor.update(
        () => {
          const previous = $createParagraphNode()
            .append($createTextNode('previous'))
            .setIndent(depth);
          const text = $createTextNode('selected');
          const paragraph = $createParagraphNode()
            .append(text)
            .setIndent(depth);
          $getRoot().append(previous, paragraph);
          text.select(0, 8);
          editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
          expect(paragraph.getIndent()).toBe(depth + 1);
          editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
          expect(paragraph.getIndent()).toBe(depth + 1);
        },
        { discrete: true }
      );
    }
  );

  it.each([
    { kind: 'quote', create: $createQuoteNode },
    { kind: 'heading', create: () => $createHeadingNode('h2') },
    { kind: 'code', create: $createCodeNode },
  ])('does not indent a $kind block', ({ create }) => {
    const { editor } = behaviorEditor(tabIndentationPlugin());
    editor.update(
      () => {
        const text = $createTextNode('selected');
        const block = create().append(text);
        $getRoot().append(block);
        text.select(0, 8);
        editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
        expect(block.getIndent()).toBe(0);
      },
      { discrete: true }
    );
  });

  it.each([false, true])(
    'Tab with shift=%s delegates to the matching indent command',
    (shiftKey) => {
      const { editor } = behaviorEditor(tabIndentationPlugin());
      const received: string[] = [];
      const remove = editor.registerCommand(
        OUTDENT_CONTENT_COMMAND,
        () => {
          received.push('outdent');
          return true;
        },
        COMMAND_PRIORITY_LOW
      );
      try {
        editor.update(
          () => {
            const text = $createTextNode('selected');
            const paragraph = $createParagraphNode().append(text);
            $getRoot().append(paragraph);
            text.select(0, 0);
            const event = new KeyboardEvent('keydown', {
              key: 'Tab',
              shiftKey,
              cancelable: true,
            });
            expect(editor.dispatchCommand(KEY_TAB_COMMAND, event)).toBe(true);
            expect(event.defaultPrevented).toBe(true);
            expect(received).toEqual(shiftKey ? ['outdent'] : []);
            expect(paragraph.getIndent()).toBe(shiftKey ? 0 : 1);
          },
          { discrete: true }
        );
      } finally {
        remove();
      }
    }
  );
});
