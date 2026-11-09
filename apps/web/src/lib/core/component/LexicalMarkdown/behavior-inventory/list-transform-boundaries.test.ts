import { $isListItemNode, $isListNode } from '@lexical/list';
import { CHECK_LIST, ORDERED_LIST, UNORDERED_LIST } from '@lexical/markdown';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import { CUSTOM_TRANSFORMERS } from '@macro-inc/lexical-core/transformers/customTransformers';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { behaviorEditor } from './editor';

for (const isImport of [true, false]) {
  describe(`custom list transform boundaries (import=${isImport})`, () => {
    for (const tag of ['paragraph', 'h1', 'h2', 'h3'] as const) {
      it.each([
        { original: ORDERED_LIST, marker: '6. ', type: 'number' },
        { original: UNORDERED_LIST, marker: '- ', type: 'bullet' },
        { original: CHECK_LIST, marker: '[x] ', type: 'check' },
      ] as const)(
        `$type transforms a ${tag} only when it is a paragraph`,
        ({ original, marker, type }) => {
          const transformer = CUSTOM_TRANSFORMERS.find(
            (candidate) =>
              candidate.type === 'element' &&
              candidate.regExp.source === original.regExp.source
          );
          if (!transformer || transformer.type !== 'element')
            throw new Error('Missing custom list transformer');
          const match = marker.match(transformer.regExp);
          if (!match) throw new Error(`Missing marker match for ${type}`);
          const { editor } = behaviorEditor();
          editor.update(
            () => {
              const block =
                tag === 'paragraph'
                  ? $createParagraphNode()
                  : $createHeadingNode(tag);
              block.append($createTextNode('Retained'));
              $getRoot().append(block);
              const result = transformer.replace(
                block,
                block.getChildren(),
                match,
                isImport
              );
              if (tag !== 'paragraph') expect(result).toBe(false);
            },
            { discrete: true }
          );
          editor.read(() => {
            const block = $getRoot().getFirstChild();
            expect($getRoot().getChildren()).toHaveLength(1);
            expect(block?.getTextContent()).toBe('Retained');
            if (tag === 'paragraph') {
              expect($isListNode(block) && block.getListType()).toBe(type);
              if (type === 'check' && $isListNode(block)) {
                const item = block.getFirstChild();
                expect($isListItemNode(item) && item.getChecked()).toBe(true);
              }
              if (type === 'number' && $isListNode(block))
                expect(block.getStart()).toBe(6);
            } else expect($isHeadingNode(block) && block.getTag()).toBe(tag);
          });
        }
      );
    }
  });
}
