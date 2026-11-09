import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { ElementNode, LexicalNode, ParagraphNode, TextNode } from '../index';

test('format flags read latest captured fields without invoking format getter overrides', () => {
  const editor = createEditor({
    namespace: 'format observations',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const text = new TextNode('text').setFormat('bold');
        const paragraph = new ParagraphNode().setTextFormat(1).append(text);
        $getRoot().append(paragraph);
        let getterCalls = 0;
        text.getFormat = () => {
          getterCalls++;
          return 0;
        };
        paragraph.getTextFormat = () => {
          getterCalls++;
          return 0;
        };
        expect(text.getFormatFlags('bold', null)).toBe(0);
        expect(paragraph.getFormatFlags('bold', null)).toBe(0);
        expect(getterCalls).toBe(0);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('base JSON reads the captured type without invoking a type getter override', () => {
  const editor = createEditor({
    namespace: 'type observations',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const text = new TextNode('text');
        $getRoot().append(new ParagraphNode().append(text));
        let getterCalls = 0;
        text.getType = () => {
          getterCalls++;
          return 'overridden';
        };
        expect(LexicalNode.prototype.exportJSON.call(text)).toEqual({
          type: 'text',
          version: 1,
        });
        expect(getterCalls).toBe(0);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('element JSON observes text format and style getters once in upstream order', () => {
  const editor = createEditor({
    namespace: 'JSON observations',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const paragraph = new ParagraphNode();
        $getRoot().append(paragraph);
        const observations: string[] = [];
        paragraph.getTextFormat = () => {
          observations.push('format');
          return 1;
        };
        paragraph.getTextStyle = () => {
          observations.push('style');
          return 'color: red';
        };
        const json = ElementNode.prototype.exportJSON.call(paragraph);
        expect(json.textFormat).toBe(1);
        expect(json.textStyle).toBe('color: red');
        expect(observations).toEqual(['format', 'style']);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
