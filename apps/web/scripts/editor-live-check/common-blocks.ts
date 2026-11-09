import { createHeadlessEditor } from '@lexical/headless';
import { $createLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createTableNodeWithDimensions } from '@lexical/table';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import { $createCommentNode } from '@macro-inc/lexical-core/nodes/CommentNode';
import { $createCustomCodeNode } from '@macro-inc/lexical-core/nodes/CustomCodeNode';
import { $createEquationNode } from '@macro-inc/lexical-core/nodes/EquationNode';
import { $createImageNode } from '@macro-inc/lexical-core/nodes/ImageNode';
import { $createUserMentionNode } from '@macro-inc/lexical-core/nodes/UserMentionNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
} from 'lexical';

/** Author clipboard input with the real source classes, never a live state setter. */
export function commonBlocksClipboard(namespace: string): string {
  const editor = createHeadlessEditor({
    namespace,
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const heading = $createHeadingNode('h2').append(
        $createTextNode('Install heading')
      );
      const list = $createListNode('bullet').append(
        $createListItemNode().append($createTextNode('Install list item'))
      );
      const checklist = $createListNode('check').append(
        $createListItemNode(true).append(
          $createTextNode('Install checked item')
        )
      );
      const code = $createCustomCodeNode('javascript').append(
        $createTextNode('const persistedValue = "durable 😀";')
      );
      const table = $createTableNodeWithDimensions(2, 2, true);
      let index = 0;
      for (const row of table.getChildren()) {
        if (!$isElementNode(row))
          throw new Error('Source table row is not an element');
        for (const cell of row.getChildren()) {
          if (!$isElementNode(cell))
            throw new Error('Source table cell is not an element');
          const paragraph = cell.getFirstChild();
          if (!$isElementNode(paragraph))
            throw new Error('Source table paragraph is missing');
          paragraph.append($createTextNode(`Install cell ${++index}`));
        }
      }
      const quote = $createQuoteNode().append($createTextNode('Install quote'));
      const link = $createParagraphNode().append(
        $createLinkNode('https://example.com/install-check').append(
          $createTextNode('Install link')
        )
      );
      const mention = $createParagraphNode().append(
        $createUserMentionNode({
          userId: 'macro|install-check@example.com',
          email: 'install-check@example.com',
          displayName: 'Install mention',
        })
      );
      const equation = $createEquationNode('x^2 + y^2 = z^2', false);
      const image = $createImageNode({
        srcType: 'url',
        id: 'install-check-image',
        alt: 'Install image',
        width: 1,
        height: 1,
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
      });
      const comment = $createParagraphNode().append(
        $createCommentNode({
          ids: ['install-check-comment'],
          isDraft: false,
        }).append($createTextNode('Install comment anchor'))
      );
      $getRoot().append(
        heading,
        list,
        checklist,
        code,
        table,
        quote,
        link,
        mention,
        equation,
        image,
        comment,
        $createParagraphNode().append($createTextNode('Install end'))
      );
    },
    { discrete: true }
  );
  return JSON.stringify({
    namespace,
    nodes: editor.getEditorState().toJSON().root.children,
  });
}
