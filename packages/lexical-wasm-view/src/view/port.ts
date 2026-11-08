import type {
  EditorInputMsg,
  IClipboardMsg,
  IQueryMsg,
  IQueryReplyMsg,
  ISelectionChangeMsg,
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
  acknowledgeSelection(selection: ViewSelection): void;
  text(key: NodeKey): string | null;
}
/** Model boundary shared by production sessions and the development shim. */
export interface EditorPort {
  types(): readonly TypeRow[];
  listeners(): ReadonlyMap<string, number>;
  textFromView(input: TextFromView): void;
  debugInsertion(
    selection: ViewSelection,
    format: number,
    style: string,
    text: string,
    facts: number
  ): boolean | undefined;
  selectionFromView(
    selection: ViewSelection,
    change?: ISelectionChangeMsg
  ): void;
  command(
    code: number,
    a?: number,
    b?: number,
    text?: string
  ): boolean | undefined;
  keyDown(
    code: number,
    mods: number,
    routed: number,
    key: string,
    selection: ViewSelection
  ): boolean | undefined;
  input(input: EditorInputMsg, after?: (handled: boolean) => void): void;
  setState(json: string): void;
  initialize(): void;
  clipboard(kind: number): IClipboardMsg;
  query(query: IQueryMsg): IQueryReplyMsg;
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
