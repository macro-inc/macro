import { createHeadlessEditor } from '@lexical/headless';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { NODE_TRANSFORM, nodeTransformPlugin } from './nodeTransformPlugin';

describe('block formatting selection boundaries', () => {
  for (const backward of [false, true]) {
    for (const endAtBlockStart of [false, true]) {
      it.each(['quote', 'heading1'] as const)(
        `applies %s with backward=${backward}, endAtBlockStart=${endAtBlockStart}`,
        (format) => {
          const editor = createHeadlessEditor({
            nodes: [HeadingNode, QuoteNode],
            onError: (error) => {
              throw error;
            },
          });
          const unregister = nodeTransformPlugin()(editor);
          editor.update(
            () => {
              const first = $createTextNode('First paragraph');
              const middle = $createTextNode('Second paragraph');
              const last = $createTextNode('Third paragraph');
              $getRoot().append(
                $createParagraphNode().append(first),
                $createParagraphNode().append(middle),
                $createParagraphNode().append(last)
              );
              const selection = $createRangeSelection();
              const start = backward ? selection.focus : selection.anchor;
              const end = backward ? selection.anchor : selection.focus;
              start.set(first.getKey(), 0, 'text');
              end.set(
                last.getKey(),
                endAtBlockStart ? 0 : last.getTextContentSize(),
                'text'
              );
              $setSelection(selection);
              const selectedText = selection.getTextContent();

              editor.dispatchCommand(NODE_TRANSFORM, format);

              const type = format === 'quote' ? 'quote' : 'heading';
              expect(
                $getRoot()
                  .getChildren()
                  .map((node) => node.getType())
              ).toEqual([type, type, endAtBlockStart ? 'paragraph' : type]);
              const updatedSelection = $getSelection();
              expect($isRangeSelection(updatedSelection)).toBe(true);
              if ($isRangeSelection(updatedSelection)) {
                expect(updatedSelection.isBackward()).toBe(backward);
                expect(updatedSelection.getTextContent()).toBe(selectedText);
              }
            },
            { discrete: true }
          );
          unregister();
        }
      );
    }
  }
});
