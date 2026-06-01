import type { TextMatchTransformer } from '@lexical/markdown';
import type { TextNode } from 'lexical';
import { $createAwaitNode, type AwaitNodeInfo } from '../nodes/AwaitNode';

/**
 * Internal transformer for persisted await placeholders.
 *
 * Await nodes are normally inserted by editor commands for local pending work,
 * but server-authored pending messages need an internal markdown sentinel so
 * static channel markdown can render the same placeholder node.
 */
export const I_AWAIT_NODE: TextMatchTransformer = {
  // Keep this dependency-free to avoid a module-init cycle through the
  // @lexical-core barrel. AwaitNode is already registered by SupportedNodeTypes.
  dependencies: [],
  type: 'text-match',
  regExp: /<m-await>(.*?)<\/m-await>/,
  importRegExp: /<m-await>(.*?)<\/m-await>/,
  export: (node) => {
    if (node.getType() !== 'await' || !('exportComponentProps' in node)) {
      return null;
    }
    const data = JSON.stringify(
      (
        node as typeof node & {
          exportComponentProps: () => AwaitNodeInfo;
        }
      ).exportComponentProps()
    );
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
