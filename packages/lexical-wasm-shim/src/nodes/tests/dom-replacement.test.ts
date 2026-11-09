// @vitest-environment jsdom
import {
  createEditor as createOriginalEditor,
  LineBreakNode as OriginalLineBreakNode,
  ParagraphNode as OriginalParagraphNode,
} from 'lexical';
import { expect, test } from 'vitest';
import { createEditor } from '../../editor';
import { LineBreakNode, ParagraphNode } from '../index';

test.each(['paragraph', 'linebreak'])(
  'DOM %s factory observes actual registered replacement dispatch like Original',
  (type) => {
    const failure = { reason: 'registered replacement getter' };
    const originalEvents: string[] = [];
    const actualEvents: string[] = [];
    const original = createOriginalEditor({
      onError: (error) => {
        throw error;
      },
    });
    const originalRow = original._nodes.get(type);
    if (originalRow === undefined)
      throw new Error('missing Original registration');
    Object.defineProperty(originalRow, 'replace', {
      get() {
        originalEvents.push(type);
        throw failure;
      },
    });
    original.update(
      () => {
        const element = document.createElement(
          type === 'paragraph' ? 'p' : 'br'
        );
        const map =
          type === 'paragraph'
            ? OriginalParagraphNode.importDOM()
            : OriginalLineBreakNode.importDOM();
        const conversion = map?.[element.nodeName.toLowerCase()](element);
        if (conversion == null) throw new Error('missing Original conversion');
        expect(() => conversion.conversion(element)).toThrow(failure);
      },
      { discrete: true }
    );
    const actual = createEditor();
    try {
      const actualRow = actual._nodes.get(type);
      if (actualRow === undefined)
        throw new Error('missing actual registration');
      Object.defineProperty(actualRow, 'replace', {
        get() {
          actualEvents.push(type);
          throw failure;
        },
      });
      actual.update(
        () => {
          const element = document.createElement(
            type === 'paragraph' ? 'p' : 'br'
          );
          const map =
            type === 'paragraph'
              ? ParagraphNode.importDOM()
              : LineBreakNode.importDOM();
          const conversion = map?.[element.nodeName.toLowerCase()](element);
          if (conversion == null) throw new Error('missing actual conversion');
          expect(() => conversion.conversion(element)).toThrow(failure);
        },
        { discrete: true }
      );
      expect(actualEvents).toEqual(originalEvents);
      expect(actualEvents).toEqual([type]);
    } finally {
      actual.dispose();
    }
  }
);
