import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { ParagraphNode } from '../index';

test('paragraph JSON refreshes both legacy fields when either element field is absent', () => {
  const editor = createEditor({
    namespace: 'paragraph JSON',
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
        let formatCalls = 0;
        let styleCalls = 0;
        paragraph.getTextFormat = () => {
          observations.push('format');
          return ++formatCalls;
        };
        paragraph.getTextStyle = () => {
          observations.push('style');
          return styleCalls++ === 0 ? '' : 'color: red';
        };
        const json = paragraph.exportJSON();
        expect(json.textFormat).toBe(2);
        expect(json.textStyle).toBe('color: red');
        expect(observations).toEqual(['format', 'style', 'format', 'style']);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
