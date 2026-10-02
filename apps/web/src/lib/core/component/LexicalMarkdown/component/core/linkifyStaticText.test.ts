import { $createCodeNode, CodeNode } from '@lexical/code';
import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { expect, it } from 'vitest';
import { $linkifyStaticText } from './linkifyStaticText';

it('links bare review URLs, preserving formatted links, inline code, and code blocks', () => {
  const editor = createEditor({
    namespace: 'static-links-test',
    nodes: [LinkNode, CodeNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const root = $getRoot();
      root.append(
        $createParagraphNode().append(
          $createTextNode(
            'See https://macro.com/app/agent/test?s0.review.target=one and https://macro.com/second.'
          )
        )
      );
      root.append(
        $createParagraphNode().append(
          $createTextNode('https://macro.com/code').toggleFormat('code')
        )
      );
      root.append(
        $createCodeNode().append($createTextNode('https://macro.com/block'))
      );
      root.append(
        $createParagraphNode().append(
          $createLinkNode('https://macro.com/existing').append(
            $createTextNode('https://macro.com/existing')
          )
        )
      );
      $linkifyStaticText();
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    const linked = $getRoot()
      .getAllTextNodes()
      .map((n) => n.getParent())
      .filter($isLinkNode);
    expect(linked.map((n) => n.getURL())).toEqual([
      'https://macro.com/app/agent/test?s0.review.target=one',
      'https://macro.com/second',
      'https://macro.com/existing',
    ]);
    expect(linked.every((n) => !$isLinkNode(n.getParent()))).toBe(true);
  });
});
