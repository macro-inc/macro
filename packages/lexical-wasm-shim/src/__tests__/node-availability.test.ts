import { expect, test } from 'vitest';
import { createEditor, ParagraphNode, TextNode } from '../index';

test('node availability checks registered type names independently of constructor authority', () => {
  class SameNameText extends TextNode {
    static getType(): string {
      return 'text';
    }
  }
  class MissingText extends TextNode {
    static getType(): string {
      return 'missing-text';
    }
  }
  const editor = createEditor();
  try {
    expect(editor._nodes.get('text')?.klass).toBe(TextNode);
    expect(editor._nodes.get('text')?.klass).not.toBe(SameNameText);
    expect(editor.hasNode(SameNameText)).toBe(true);
    expect(editor.hasNodes([TextNode, SameNameText])).toBe(true);
    expect(editor.hasNodes([TextNode, MissingText])).toBe(false);
    expect(editor.hasNodes([])).toBe(true);
  } finally {
    editor.dispose();
  }
});

test('availability samples getType in source order and preserves opaque errors', () => {
  const calls: string[] = [];
  const error = {};
  class ObservedText extends TextNode {
    static getType(): string {
      calls.push('text');
      return 'text';
    }
  }
  class ThrowingParagraph extends ParagraphNode {
    static getType(): string {
      calls.push('paragraph');
      throw error;
    }
  }
  const editor = createEditor();
  try {
    try {
      editor.hasNodes([ObservedText, ThrowingParagraph]);
      expect.unreachable('Expected the original getType error');
    } catch (cause) {
      expect(cause).toBe(error);
    }
    expect(calls).toEqual(['text', 'paragraph']);
  } finally {
    editor.dispose();
  }
});
