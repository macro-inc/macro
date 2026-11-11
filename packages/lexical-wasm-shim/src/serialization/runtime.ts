import type { EditorState, LexicalEditor } from '../editor';
import type { RootNode } from '../nodes';
import type { RegisteredNodes } from '../nodes/replacement/types';

export interface JSONRuntime {
  readonly getActiveEditor: () => LexicalEditor;
  readonly getRegisteredNodes: (editor: LexicalEditor) => RegisteredNodes;
  readonly readEditorState: <V>(state: EditorState, body: () => V) => V;
  readonly getRoot: () => RootNode;
}

let runtime: JSONRuntime | undefined;

export function bindJSONRuntime(value: JSONRuntime): void {
  runtime = value;
}

export function getJSONRuntime(): JSONRuntime {
  if (runtime === undefined)
    throw new Error('Actual JSON serialization runtime has not been bound');
  return runtime;
}
