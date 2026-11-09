import type {
  Klass,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  NodeMutation,
} from 'lexical';
export type RegisteredNodes = LexicalEditor['_nodes'];
export type MutationListeners = LexicalEditor['_listeners']['mutation'];
export type MutatedNodes = Map<Klass<LexicalNode>, Map<NodeKey, NodeMutation>>;
export type LexicalPrivateDOM =
  LexicalEditor['_keyToDOMMap'] extends Map<string, infer DOM>
    ? Omit<DOM, keyof HTMLElement>
    : never;
