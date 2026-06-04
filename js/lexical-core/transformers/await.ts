import type { TextMatchTransformer } from '@lexical/markdown';
import type { TextNode } from 'lexical';
import {
  $createAwaitNode,
  $isAwaitNode,
  AwaitNode,
} from '../nodes/AwaitNode';

/**
 * Internal transformer for persisted await placeholders.
 *
 * Await nodes are normally inserted by editor commands for local pending work,
 * but server-authored pending messages need an internal markdown sentinel so
 * static channel markdown can render the same placeholder node.
 */
export const I_AWAIT_NODE: TextMatchTransformer = {
  dependencies: [AwaitNode],
  type: 'text-match',
  regExp: /<m-await>(.*?)<\/m-await>/,
  importRegExp: /<m-await>(.*?)<\/m-await>/,
  export: (node) => {
    if (!$isAwaitNode(node)) {
      return null;
    }
    const data = JSON.stringify(node.exportComponentProps());
    return `<m-await>${data}</m-await>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      node.replace(
        $createAwaitNode({
          awaitId: typeof data.awaitId === 'string' ? data.awaitId : undefined,
          text: typeof data.text === 'string' ? data.text : undefined,
          inline: typeof data.inline === 'boolean' ? data.inline : true,
        })
      );
    } catch (e) {
      console.error('Error in I_AWAIT_NODE replace:', e);
    }
  },
};
