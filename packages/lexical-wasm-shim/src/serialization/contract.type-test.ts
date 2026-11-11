import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import type { EditorState } from '../editor';
import type { LexicalNode } from '../nodes';
import { exportEditorState } from './export';
import { $parseSerializedNode } from './parse';
import type { JSONRuntime } from './runtime';

declare const state: EditorState;
declare const serialized: SerializedLexicalNode;
declare const runtime: JSONRuntime;
export const parsed: LexicalNode = $parseSerializedNode(serialized);
export const exported: SerializedEditorState = exportEditorState(state);
const opaque = { token: Symbol() };
export const readResult: typeof opaque = runtime.readEditorState(
  state,
  () => opaque
);
