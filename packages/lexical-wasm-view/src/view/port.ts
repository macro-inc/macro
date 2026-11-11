import type {
  EditorInputMsg,
  IClipboardMsg,
  IQueryMsg,
  IQueryReplyMsg,
  ISelectionChangeMsg,
  ISelectionMsg,
  IViewEffectMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { ViewCommandPriority } from './commands';
import type { NativeEnterScope } from './native-enter';
import type { NativeCallbackFailure } from './native-enter-output';
import type { NodeKey, TypeRow, ViewSelection } from './types';

export interface NativeEnterPort {
  register(
    listener: (event: KeyboardEvent | null) => boolean,
    priority: ViewCommandPriority,
    identity?: object
  ): () => void;
  hasListeners(): boolean;
  scope(): NativeEnterScope | undefined;
  dispatch(): boolean;
  dispatchScoped(input: EditorInputMsg): boolean;
  pendingSelection(): ISelectionMsg;
  pendingText(key: NodeKey): string;
  pendingOwnJSON(key: NodeKey): string;
  takeFailure(): NativeCallbackFailure | undefined;
  dispose(): void;
}

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
  readonly nativeEnter?: NativeEnterPort;
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
    selection: ViewSelection,
    event?: KeyboardEvent
  ): boolean | undefined;
  input(
    input: EditorInputMsg,
    after?: (handled: boolean) => void,
    event?: KeyboardEvent
  ): void;
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
