import {
  createEditor as createOriginalEditor,
  $createRangeSelection as createOriginalRangeSelection,
  $getRoot as getOriginalRoot,
  LineBreakNode as OriginalLineBreakNode,
  ParagraphNode as OriginalParagraphNode,
  TabNode as OriginalTabNode,
  TextNode as OriginalTextNode,
  type SerializedParagraphNode,
  type SerializedTextNode,
} from 'lexical';
import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { $createRangeSelection } from '../../selection/helpers';
import { LineBreakNode, ParagraphNode, TabNode, TextNode } from '../index';

const textJSON: SerializedTextNode = {
  type: 'text',
  version: 1,
  text: 'imported',
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
};
const tabJSON: SerializedTextNode = {
  ...textJSON,
  type: 'tab',
  text: '\t',
  detail: 2,
};
const paragraphJSON: SerializedParagraphNode = {
  type: 'paragraph',
  version: 1,
  children: [],
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
};
const lineBreakJSON = { type: 'linebreak', version: 1 };
const factories = [
  {
    type: 'text',
    original: () => OriginalTextNode.importJSON(textJSON),
    actual: () => TextNode.importJSON(textJSON),
  },
  {
    type: 'tab',
    original: () => OriginalTabNode.importJSON(tabJSON),
    actual: () => TabNode.importJSON(tabJSON),
  },
  {
    type: 'paragraph',
    original: () => OriginalParagraphNode.importJSON(paragraphJSON),
    actual: () => ParagraphNode.importJSON(paragraphJSON),
  },
  {
    type: 'linebreak',
    original: () => OriginalLineBreakNode.importJSON(lineBreakJSON),
    actual: () => LineBreakNode.importJSON(lineBreakJSON),
  },
];

test.each(factories)(
  '$type static import observes Original registered replacement before updateFromJSON',
  ({ type, original: importOriginal, actual: importActual }) => {
    const failure = { reason: 'import replacement' };
    const original = createOriginalEditor({
      onError: (error) => {
        throw error;
      },
    });
    const originalRow = original._nodes.get(type);
    if (originalRow === undefined) throw new Error('missing Original row');
    let originalCalls = 0;
    Object.defineProperty(originalRow, 'replace', {
      get() {
        originalCalls++;
        throw failure;
      },
    });
    original.update(
      () => {
        expect(importOriginal).toThrow(failure);
      },
      { discrete: true }
    );
    const actual = createEditor();
    try {
      const row = actual._nodes.get(type);
      if (row === undefined) throw new Error('missing actual row');
      let calls = 0;
      Object.defineProperty(row, 'replace', {
        get() {
          calls++;
          throw failure;
        },
      });
      actual.update(
        () => {
          expect(importActual).toThrow(failure);
        },
        { discrete: true }
      );
      expect(calls).toBe(originalCalls);
      expect(calls).toBe(1);
    } finally {
      actual.dispose();
    }
  }
);

test.each(['parent', 'after'])(
  '%s paragraph creation observes Original replacement dispatch',
  (operation) => {
    const failure = { reason: 'paragraph replacement' };
    const original = createOriginalEditor({
      onError: (error) => {
        throw error;
      },
    });
    let originalCalls = 0;
    original.update(
      () => {
        const paragraph = new OriginalParagraphNode();
        const text = new OriginalTextNode('source');
        getOriginalRoot().append(paragraph.append(text));
        const selection = createOriginalRangeSelection();
        const row = original._nodes.get('paragraph');
        if (row === undefined) throw new Error('missing Original paragraph');
        Object.defineProperty(row, 'replace', {
          get() {
            originalCalls++;
            throw failure;
          },
        });
        expect(() =>
          operation === 'parent'
            ? text.createParentElementNode()
            : paragraph.insertNewAfter(selection, false)
        ).toThrow(failure);
      },
      { discrete: true }
    );
    const actual = createEditor();
    try {
      let calls = 0;
      actual.update(
        () => {
          const paragraph = new ParagraphNode();
          const text = new TextNode('source');
          $getRoot().append(paragraph.append(text));
          const selection = $createRangeSelection();
          const row = actual._nodes.get('paragraph');
          if (row === undefined) throw new Error('missing actual paragraph');
          Object.defineProperty(row, 'replace', {
            get() {
              calls++;
              throw failure;
            },
          });
          expect(() =>
            operation === 'parent'
              ? text.createParentElementNode()
              : paragraph.insertNewAfter(selection, false)
          ).toThrow(failure);
        },
        { discrete: true }
      );
      expect(calls).toBe(originalCalls);
      expect(calls).toBe(1);
    } finally {
      actual.dispose();
    }
  }
);
