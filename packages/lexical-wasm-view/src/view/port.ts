import type {
  EditorInputMsg,
  IViewEffectMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { NodeKey, TypeRow, ViewSelection } from './types';

export interface TextFromView {
  readonly key: NodeKey;
  readonly text: string;
  readonly anchorOffset: number;
  readonly focusOffset: number;
  readonly selectionKind?: 'range' | 'keep' | 'none';
  readonly compositionEnd?: boolean;
  readonly compositionData?: string;
}
export interface ViewSink {
  apply(
    words: Uint32Array,
    strings: Uint8Array,
    effects: IViewEffectMsg[]
  ): void;
  acknowledgeText(input: TextFromView): void;
  text(key: NodeKey): string | null;
}
/** Model boundary shared by production sessions and the development shim. */
export interface EditorPort {
  types(): readonly TypeRow[];
  listeners(): ReadonlyMap<string, number>;
  textFromView(input: TextFromView): void;
  selectionFromView(selection: ViewSelection): void;
  command(code: number, a?: number, b?: number, text?: string): void;
  keyDown(code: number, mods: number, routed: number, key: string): void;
  input(input: EditorInputMsg): void;
  setState(json: string): void;
  composition(
    kind: number,
    key: NodeKey,
    text: string,
    anchor: number,
    focus: number,
    data: string
  ): void;
}
/** Implemented by the shim worker; production never loads the shim. */
export interface ConformancePort extends EditorPort {
  flush(): void;
}
