// @vitest-environment jsdom
import {
  createEditor as createOriginalEditor,
  ParagraphNode as OriginalParagraphNode,
} from 'lexical';
import { expect, test } from 'vitest';
import { createEditor } from '../../editor';
import { ParagraphNode } from '../index';

function paragraphWithObservedAttributes(
  events: string[],
  alignment: string
): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  paragraph.setAttribute('align', 'right');
  paragraph.style.textAlign = alignment;
  paragraph.setAttribute('data-lexical-indent', '3');
  paragraph.setAttribute('dir', 'rtl');
  const getAttribute = paragraph.getAttribute;
  paragraph.getAttribute = function (name) {
    events.push(name);
    return getAttribute.call(this, name);
  };
  return paragraph;
}

test.each(['', 'center'])(
  'paragraph import preserves Original attribute order and scalar results with CSS %s',
  (alignment) => {
    const originalEvents: string[] = [];
    const actualEvents: string[] = [];
    const original = createOriginalEditor({
      onError: (error) => {
        throw error;
      },
    });
    let originalScalars: unknown;
    original.update(
      () => {
        const element = paragraphWithObservedAttributes(
          originalEvents,
          alignment
        );
        const node = OriginalParagraphNode.importDOM()
          ?.p(element)
          ?.conversion(element)?.node;
        if (!(node instanceof OriginalParagraphNode))
          throw new Error('expected Original paragraph');
        originalScalars = [
          node.getFormatType(),
          node.getIndent(),
          node.getDirection(),
        ];
      },
      { discrete: true }
    );
    const actual = createEditor();
    try {
      actual.update(
        () => {
          const element = paragraphWithObservedAttributes(
            actualEvents,
            alignment
          );
          const node = ParagraphNode.importDOM()
            ?.p(element)
            ?.conversion(element)?.node;
          if (!(node instanceof ParagraphNode))
            throw new Error('expected actual paragraph');
          expect([
            node.getFormatType(),
            node.getIndent(),
            node.getDirection(),
          ]).toEqual(originalScalars);
        },
        { discrete: true }
      );
      expect(originalEvents).toEqual(
        alignment === ''
          ? ['data-lexical-indent', 'align', 'dir']
          : ['data-lexical-indent', 'dir']
      );
      expect(actualEvents).toEqual(originalEvents);
    } finally {
      actual.dispose();
    }
  }
);
