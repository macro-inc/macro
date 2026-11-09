import type { DOMExportOutput } from 'lexical';
import type { LexicalEditor } from '../../editor';
import type { LexicalNode } from '../base';
import type { SharedState } from '../state/shared';

export type { LexicalNodeReplacement } from 'lexical';

export type ClassLike = Function & { readonly prototype: object };

export type NodeClass = LexicalNode['constructor'];
type GenericConstructor<T> = new (
  ...args: ConstructorParameters<LexicalNode['constructor']>
) => T;
export type Klass<T extends LexicalNode> =
  InstanceType<T['constructor']> extends T
    ? T['constructor']
    : GenericConstructor<T> & T['constructor'];
export type Transform<T extends LexicalNode> = (node: T) => void;
export type NodeDOMExport = (
  editor: LexicalEditor,
  targetNode: LexicalNode
) => DOMExportOutput;

export type RegisteredNode = {
  klass: NodeClass;
  transforms: Set<Transform<LexicalNode>>;
  replace: null | ((node: LexicalNode) => LexicalNode);
  replaceWithKlass: NodeClass | null;
  exportDOM?: NodeDOMExport;
  sharedNodeState: SharedState;
};
export type RegisteredNodes = Map<string, RegisteredNode>;

/** Internal invoker only; this is not the public LexicalNodeReplacement alias. */
export type BoundNodeReplacement = {
  replace: NodeClass;
  with: (node: LexicalNode) => LexicalNode;
  withKlass?: NodeClass;
};
export type InternalNodeConfig = NodeClass | BoundNodeReplacement;
export type NodeConfigInput =
  | ClassLike
  | import('lexical').LexicalNodeReplacement
  | BoundNodeReplacement;

export interface ReplacementRuntime {
  readonly getActiveEditor: () => LexicalEditor;
  readonly getRegisteredNodes: (editor: LexicalEditor) => RegisteredNodes;
  readonly errorOnReadOnly: () => void;
}
