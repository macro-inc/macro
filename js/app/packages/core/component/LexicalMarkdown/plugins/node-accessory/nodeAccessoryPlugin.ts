import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import type { Component } from 'solid-js';
import {
  createStore,
  type SetStoreFunction,
  type Store,
  unwrap,
} from 'solid-js/store';

export const FORCE_REFRESH_ACCESSORIES_COMMAND = createCommand<NodeKey[]>(
  'FORCE_REFRESH_ACCESSORIES_COMMAND'
);

export type NodeAccessory = Component<{
  ref: HTMLElement;
  key: NodeKey;
}>;

export type AccessoryItem = {
  key: NodeKey;
  mountRef: HTMLElement;
  component: NodeAccessory;
};

export type AccessoryStore = Store<Record<NodeKey, AccessoryItem>>;

export function createAccessoryStore() {
  return createStore<Record<NodeKey, AccessoryItem>>({});
}

export type NodeAccessoryPluginProps<T extends LexicalNode> = {
  klass: Klass<T>;
  component: NodeAccessory;
  store: AccessoryStore;
  setStore: SetStoreFunction<AccessoryStore>;
};

function registerNodeAcessoryPlugin<T extends LexicalNode>(
  editor: LexicalEditor,
  props: NodeAccessoryPluginProps<T>
) {
  return mergeRegister(
    editor.registerMutationListener(props.klass, (nodes) => {
      for (const [key, mutation] of nodes) {
        if (mutation === 'created' || mutation === 'updated') {
          const element = editor.getElementByKey(key);
          if (element) {
            element.classList.add('__decorator-mount-ref');
            props.setStore(key, {
              key,
              mountRef: element,
              component: props.component,
            });
          }
        } else if (mutation === 'destroyed') {
          props.setStore(key, undefined!);
        }
      }
    }),
    editor.registerCommand(
      FORCE_REFRESH_ACCESSORIES_COMMAND,
      (payload) => {
        for (const key of payload) {
          if (key in props.store) {
            const temp = { ...unwrap(props.store[key]) };
            props.setStore(key, undefined!);
            props.setStore(key, temp);
          }
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

/**
 * This plugin lets you attach and render some arbitrary non-lexical component for
 * every lexical node of a given class. This is similar to Lexical's own Decorator pattern
 * but is not invasive to Lexical's state. For example to add some menu to all paragraphs
 * in the editor you would have to define a custom paragraph class that manages rendering
 * itself and a decorator and then override the default paragraph node. With this approach
 * you can attach the menu to the existing paragraph node. In order to use it the containing
 * editor will also need have a <NodeAcessoryRenderer /> as a child.
 * @param props.klass The Lexical node class to bind to.
 * @param props.component The component to render for the node. This is a simple component
 *     that will only receive a ref to the editor and the node key of its attached node.
 */
export function nodeAccessoryPlugin<T extends LexicalNode>(
  props: NodeAccessoryPluginProps<T>
) {
  return (editor: LexicalEditor) => registerNodeAcessoryPlugin(editor, props);
}
