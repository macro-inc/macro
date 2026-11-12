import type {
  EditorInputMsg,
  IClipboardMsg,
  IEditorApplication,
  IQueryMsg,
  IQueryReplyMsg,
  ISelectionChangeMsg,
  ISelectionMsg,
  IViewEffectMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { ViewCommandPriority } from './commands';
import type { NativeEnterScope } from './native-enter';
import type { NativeCallbackFailure } from './native-enter-output';
import type { EditorThemeClasses } from './registry';
import type { NodeKey, TypeRow, ViewSelection } from './types';

/** A deferred application command has no invocation-scoped DOM event. */
export type ProgrammaticApplicationInput = Readonly<
  Pick<IEditorApplication, 'name' | 'json' | 'generation' | 'selection'>
>;

export interface ProgrammaticApplicationOptions {
  readonly after: (handled: boolean) => void;
}

/** Caller-owned validity checked in the authorized queued entry. */
export interface ProgrammaticApplicationAdmissionOptions {
  readonly admit: () => boolean;
}

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

export type NativeEscapePort = NativeEnterPort;

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
/** Actual input completion, distinct from completed-but-unhandled and cancellation. */
export type InputSettlement =
  | { readonly status: 'success'; readonly handled: boolean }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'cancelled';
      readonly reason:
        | 'closed'
        | 'closing'
        | 'session-access'
        | 'entry-admission';
    };
/** Model boundary shared by production sessions and the development shim. */
export interface EditorPort {
  readonly nativeEnter?: NativeEnterPort;
  readonly nativeEscape?: NativeEscapePort;
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
  inputSettled?(
    factory: () => ProgrammaticApplicationInput,
    options?: ProgrammaticApplicationOptions
  ): Promise<InputSettlement>;
  inputSettled?(
    input: EditorInputMsg,
    event?: KeyboardEvent
  ): Promise<InputSettlement>;
  /** Current native Edit authority is checked before the queued factory runs. */
  inputSettledIfSessionEdit?(
    factory: () => ProgrammaticApplicationInput,
    options?: ProgrammaticApplicationAdmissionOptions
  ): Promise<InputSettlement>;
  setState(json: string): void;
  initialize(): void;
  clipboard(
    kind: number,
    theme: EditorThemeClasses,
    document: Document
  ): IClipboardMsg;
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
