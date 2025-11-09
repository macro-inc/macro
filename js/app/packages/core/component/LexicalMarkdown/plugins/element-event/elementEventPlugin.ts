import { $findMatchingParent } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

export type ElementEventProps<T extends LexicalNode, E extends Event> = {
  eventName: string;
  guard: (node: LexicalNode) => node is T;
  callback: (event: E, node: T, key: NodeKey) => void;
};

function registerElementEventPlugin<T extends LexicalNode, E extends Event>(
  editor: LexicalEditor,
  props: ElementEventProps<T, E>
) {
  const eventHandler = (event: Event) => {
    editor.update(() => {
      const nearestNode = $getNearestNodeFromDOMNode(event.target as Element);
      if (nearestNode === null) return;
      if (props.guard(nearestNode)) {
        props.callback(event as E, nearestNode, nearestNode.getKey());
        return;
      }
      let parentTarget = $findMatchingParent(nearestNode, props.guard);
      if (parentTarget === null) return;
      props.callback(event as E, parentTarget, parentTarget.getKey());
    });
  };
  return editor.registerRootListener((root, prevRoot) => {
    if (root) {
      root.addEventListener(props.eventName, eventHandler);
    }
    if (prevRoot) {
      prevRoot.removeEventListener(props.eventName, eventHandler);
    }
  });
}

/**
 * A plugin that can attach event listeners to specific nodes in the editor.
 * The event listener will be called with the node that matches the guard.
 * @param props the props for the plugin.
 * @param props.eventName the name of the event to listen for.
 * @param props.guard a function that takes a node and returns true if the even
 *     should be called with the node.
 * @param props.callback a function that is called with the event and the node
 *     that matches the guard.
 * @returns a plugin that can attach event listeners to specific nodes in the editor.
 * @example
 * const imageClickPlugin = elementEventPlugin<ImageNode, MouseEvent>({
 *   eventName: 'click',
 *   guard: (node) => node instanceof ImageNode,
 *   callback: (event, node, key) => {
 *     console.log('Image clicked:', node.gerUrl(), key);
 *   },
 * });
 *
 * plugins.use(linkClickPlugin);
 */
export function elementEventPlugin<T extends LexicalNode, E extends Event>(
  props: ElementEventProps<T, E>
) {
  return (editor: LexicalEditor) => registerElementEventPlugin(editor, props);
}
