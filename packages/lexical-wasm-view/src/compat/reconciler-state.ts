/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import type { IntentionallyMarkedAsDirtyElement } from './reconciler';
import type {
  CompatEditorConfig as EditorConfig,
  CompatDOMRenderConfig as EditorDOMRenderConfig,
  CompatEditorState as EditorState,
  CompatEditor as LexicalEditor,
  LexicalPrivateDOM,
  MutatedNodes,
  MutationListeners,
  CompatNodeMap as NodeMap,
  RegisteredNodes,
} from './types';

class State {
  subTreeTextContent = '';
  subTreeTextFormat: number | null = null;
  subTreeTextStyle: string | null = null;
  subTreeFirstTextKey: NodeKey | null = null;
  activeEditorConfig!: EditorConfig;
  activeEditor!: LexicalEditor;
  activeEditorNodes!: RegisteredNodes;
  treatAllNodesAsDirty = false;
  activeEditorStateReadOnly = false;
  activeMutationListeners!: MutationListeners;
  activeDirtyElements!: Map<NodeKey, IntentionallyMarkedAsDirtyElement>;
  activeDirtyLeaves!: Set<NodeKey>;
  activePrevNodeMap!: NodeMap;
  activePrevEditorState!: EditorState;
  activeNextNodeMap!: NodeMap;
  activePrevKeyToDOMMap!: Map<NodeKey, HTMLElement & LexicalPrivateDOM>;
  activeDirtyChildrenByParent!: Map<NodeKey, Set<NodeKey>>;
  mutatedNodes!: MutatedNodes;
  activeEditorDOMRenderConfig!: EditorDOMRenderConfig;
}
export let reconcilerState = new State();
export function resetReconcilerState(): void {
  reconcilerState = new State();
}
