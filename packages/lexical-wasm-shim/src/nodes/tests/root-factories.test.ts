import {
  createEditor as createOriginalEditor,
  $createLineBreakNode as createOriginalLineBreak,
  $createParagraphNode as createOriginalParagraph,
  $createTextNode as createOriginalText,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  createEditor,
} from '../../index';

const factories = [
  {
    type: 'text',
    original: () => createOriginalText('factory'),
    actual: () => $createTextNode('factory'),
    text: 'factory',
  },
  {
    type: 'paragraph',
    original: createOriginalParagraph,
    actual: $createParagraphNode,
    text: '',
  },
  {
    type: 'linebreak',
    original: createOriginalLineBreak,
    actual: $createLineBreakNode,
    text: '\n',
  },
];

test.each(factories)(
  'public $type factory preserves Original registered replacement errors',
  ({ type, original: createOriginal, actual: createActual }) => {
    const failure = { reason: 'replacement factory' };
    const original = createOriginalEditor({
      onError: (error) => {
        throw error;
      },
    });
    const originalRow = original._nodes.get(type);
    if (originalRow === undefined)
      throw new Error('missing Original registration');
    let originalCalls = 0;
    Object.defineProperty(originalRow, 'replace', {
      get() {
        originalCalls++;
        throw failure;
      },
    });
    original.update(
      () => {
        expect(createOriginal).toThrow(failure);
      },
      { discrete: true }
    );
    const actual = createEditor();
    try {
      const row = actual._nodes.get(type);
      if (row === undefined) throw new Error('missing actual registration');
      let actualCalls = 0;
      Object.defineProperty(row, 'replace', {
        get() {
          actualCalls++;
          throw failure;
        },
      });
      actual.update(
        () => {
          expect(createActual).toThrow(failure);
        },
        { discrete: true }
      );
      expect(originalCalls).toBe(1);
      expect(actualCalls).toBe(originalCalls);
    } finally {
      actual.dispose();
    }
  }
);

test.each(factories)(
  'public $type factory retains actual registered node identity and input',
  ({ type, actual: createActual, text }) => {
    const editor = createEditor();
    try {
      const row = editor._nodes.get(type);
      if (row === undefined) throw new Error('missing actual registration');
      let calls = 0;
      Object.defineProperty(row, 'replace', {
        get() {
          calls++;
          return null;
        },
      });
      editor.update(
        () => {
          const node = createActual();
          expect($getNodeByKey(node.getKey())).toBe(node);
          expect(node.getType()).toBe(type);
          expect(node.getTextContent()).toBe(text);
          expect(calls).toBe(1);
        },
        { discrete: true }
      );
    } finally {
      editor.dispose();
    }
  }
);
