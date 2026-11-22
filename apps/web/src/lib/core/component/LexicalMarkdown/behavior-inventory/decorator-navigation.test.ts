import { $createDatabaseQueryNode } from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { $createDocumentCardNode } from '@macro-inc/lexical-core/nodes/DocumentCardNode';
import { $createHorizontalRuleNode } from '@macro-inc/lexical-core/nodes/HorizontalRuleNode';
import { $createImageNode } from '@macro-inc/lexical-core/nodes/ImageNode';
import { $createVideoNode } from '@macro-inc/lexical-core/nodes/VideoNode';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $selectDocumentStart,
  blockDecoratorNavigationPlugin,
} from '../plugins/block-decorator-navigation/blockDecoratorNavigationPlugin';
import { behaviorEditor } from './editor';

const DECORATORS = [
  {
    type: 'image',
    create: () =>
      $createImageNode({
        srcType: 'external',
        url: 'https://example.com/image.png',
      }),
  },
  {
    type: 'video',
    create: () =>
      $createVideoNode({
        srcType: 'external',
        url: 'https://example.com/video.mp4',
      }),
  },
  { type: 'horizontalrule', create: $createHorizontalRuleNode },
  {
    type: 'database-query',
    create: () =>
      $createDatabaseQueryNode({
        queryId: 'query',
        prompt: 'Grouped records',
        displayMode: 'table',
      }),
  },
  {
    type: 'document-card',
    create: () =>
      $createDocumentCardNode({
        documentId: 'document',
        documentName: 'Reference',
        blockName: 'md',
      }),
  },
] as const;

for (const { type, create } of DECORATORS) {
  describe(`${type} block navigation`, () => {
    for (const direction of ['up', 'down'] as const) {
      it.each([true, false])(
        `${direction} at a root caret selects the decorator only without Shift (shift=%s)`,
        (shiftKey) => {
          const { editor } = behaviorEditor(blockDecoratorNavigationPlugin());
          let key = '';
          const event = new KeyboardEvent('keydown', {
            key: direction === 'up' ? 'ArrowUp' : 'ArrowDown',
            shiftKey,
            cancelable: true,
          });
          editor.update(
            () => {
              const node = create();
              key = node.getKey();
              $getRoot().append(
                $createParagraphNode().append($createTextNode('before')),
                node,
                $createParagraphNode().append($createTextNode('after'))
              );
              $getRoot().select(
                direction === 'up' ? 2 : 1,
                direction === 'up' ? 2 : 1
              );
              expect(
                editor.dispatchCommand(
                  direction === 'up'
                    ? KEY_ARROW_UP_COMMAND
                    : KEY_ARROW_DOWN_COMMAND,
                  event
                )
              ).toBe(!shiftKey);
            },
            { discrete: true }
          );
          expect(event.defaultPrevented).toBe(!shiftKey);
          editor.read(() => {
            const selection = $getSelection();
            if (shiftKey) expect($isRangeSelection(selection)).toBe(true);
            else
              expect(
                $isNodeSelection(selection) &&
                  selection.getNodes().map((node) => node.getKey())
              ).toEqual([key]);
            expect(
              $getRoot()
                .getChildren()
                .map((node) => node.getType())
            ).toEqual(['paragraph', type, 'paragraph']);
          });
        }
      );

      it(`${direction} moves a single node selection onto an adjacent decorator`, () => {
        const { editor } = behaviorEditor(blockDecoratorNavigationPlugin());
        let targetKey = '';
        editor.update(
          () => {
            const current = create();
            const target = $createHorizontalRuleNode();
            targetKey = target.getKey();
            $getRoot().append(
              ...(direction === 'up' ? [target, current] : [current, target])
            );
            const selection = $createNodeSelection();
            selection.add(current.getKey());
            $setSelection(selection);
            expect(
              editor.dispatchCommand(
                direction === 'up'
                  ? KEY_ARROW_UP_COMMAND
                  : KEY_ARROW_DOWN_COMMAND,
                new KeyboardEvent('keydown', {
                  key: direction === 'up' ? 'ArrowUp' : 'ArrowDown',
                })
              )
            ).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          const selection = $getSelection();
          expect(
            $isNodeSelection(selection) &&
              selection.getNodes().map((node) => node.getKey())
          ).toEqual([targetKey]);
          expect($getRoot().getChildren()).toHaveLength(2);
        });
      });
    }

    it('document entry selects a leading decorator without changing content', () => {
      const { editor } = behaviorEditor(blockDecoratorNavigationPlugin());
      let key = '';
      editor.update(
        () => {
          const node = create();
          key = node.getKey();
          $getRoot().append(
            node,
            $createParagraphNode().append($createTextNode('after'))
          );
          $selectDocumentStart();
        },
        { discrete: true }
      );
      editor.read(() => {
        const selection = $getSelection();
        expect(
          $isNodeSelection(selection) &&
            selection.getNodes().map((node) => node.getKey())
        ).toEqual([key]);
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getType())
        ).toEqual([type, 'paragraph']);
      });
    });
  });
}
