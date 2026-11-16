import type {
  Access,
  EditorInputMsg,
  IClipboardMsg,
  IEditorApplication,
  IQueryMsg,
  IQueryReplyMsg,
  ISelectionChangeMsg,
  ISelectionMsg,
  IViewEffectMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type {
  ExecutorOwnedTransfer,
  SyncEntrySchedule,
} from '@macro-inc/collaboration/session/executor';
import type { ViewCommandPriority } from './commands';
import type { EditorView } from './editor-view';
import type {
  InputCommitEvidence,
  InputCommitObservation,
} from './input-commit-observation';
import type { InputDomDisposition } from './input-dom-disposition';
import type { NativeEnterScope } from './native-enter';
import type { NativeCallbackFailure } from './native-enter-output';
import type { EditorThemeClasses } from './registry';
import type { JsonValue, NodeKey, TypeRow, ViewSelection } from './types';

/** A deferred application command has no invocation-scoped DOM event. */
export type ProgrammaticApplicationInput = Readonly<
  Pick<IEditorApplication, 'name' | 'json' | 'generation' | 'selection'>
>;

/** Actual entry observation; decoded values confer no native mutation authority. */
export interface SyncInputOptions<Proof> {
  readonly view: EditorView;
  readonly generation: number;
  /** Pure JS application lease check, including optional binding retirement. */
  readonly current: () => boolean;
  readonly domRefused: () => void;
  /** The actual event being synchronously dispatched by this originating listener. */
  readonly domEvent: Event;
  readonly observation?: {
    readonly name: string;
    readonly decode: (payload: JsonValue) => Proof | undefined;
  };
  readonly after: (
    handled: boolean,
    proof: Proof | undefined,
    disposition: InputDomDisposition
  ) => void;
}
export interface SyncApplicationOptions<Proof> extends SyncInputOptions<Proof> {
  readonly admission: 'session-edit' | 'table-selection';
  readonly event?: KeyboardEvent;
}

export type ProgrammaticApplicationOptions =
  | {
      readonly after: (handled: boolean) => void;
      readonly mainCommit?: InputCommitObservation;
    }
  | {
      readonly after?: (handled: boolean) => void;
      readonly mainCommit: InputCommitObservation;
    };

/** Caller-owned validity checked in the authorized queued entry. */
export interface ProgrammaticApplicationAdmissionOptions {
  readonly admit: () => boolean;
  readonly after?: (handled: boolean) => void;
  readonly mainCommit?: InputCommitObservation;
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

/** Fixed model role; hosts measure only the native-issued block. */
export interface NativeBlockNavigationPort {
  register(
    down: boolean,
    listener: (event: KeyboardEvent | null) => boolean
  ): () => void;
  prepare(): bigint;
  block(plan: bigint): number | undefined;
  cancel(plan: bigint): void;
  dispose(): void;
  complete(
    plan: bigint,
    rects?: readonly [number, number, number, number, number]
  ): boolean;
  hasListeners(): boolean;
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
  readonly ownedTransfer?: (transfer: ExecutorOwnedTransfer) => void;
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
export type InputSettlement = (
  | { readonly status: 'success'; readonly handled: boolean }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'cancelled';
      readonly reason:
        | 'closed'
        | 'closing'
        | 'session-access'
        | 'entry-admission';
    }
) & { readonly mainCommit?: InputCommitEvidence };
/** Model boundary shared by production sessions and the development shim. */
export interface EditorPort {
  /** Native session authority, distinct from the UI editability effect. */
  effectiveAccess?(): Access;
  readonly nativeEnter?: NativeEnterPort;
  readonly nativeEscape?: NativeEscapePort;
  readonly nativeBlockNavigation?: NativeBlockNavigationPort;
  types(): readonly TypeRow[];
  listeners(): ReadonlyMap<string, number>;
  /** Pure JS full-table lookup; unknown freshness admits every generic key. */
  listenerLevels?(command: string, key?: string): number | undefined;
  needsKeyDown?(key: string): boolean | undefined;
  /** `refused` marks DOM-origin input: current Edit authority is checked at entry. */
  textFromView(input: TextFromView, refused?: () => void): void;
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
    text?: string,
    refused?: () => void
  ): boolean | undefined;
  keyDown(
    code: number,
    mods: number,
    routed: number,
    key: string,
    selection: ViewSelection,
    event?: KeyboardEvent,
    refused?: () => void
  ): boolean | undefined;
  input(
    input: EditorInputMsg,
    after?: (handled: boolean) => void,
    event?: KeyboardEvent,
    refused?: () => void
  ): void;
  inputApplicationSync?<Proof>(
    factory: () => ProgrammaticApplicationInput,
    options: SyncApplicationOptions<Proof>
  ): SyncEntrySchedule;
  pasteSync?<Proof>(
    factory: () => EditorInputMsg,
    options: SyncInputOptions<Proof>
  ): SyncEntrySchedule;
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
  /** Like inputSettledIfSessionEdit, settled before return; throws when busy. */
  inputNowIfSessionEdit(
    factory: () => ProgrammaticApplicationInput,
    options?: ProgrammaticApplicationAdmissionOptions
  ): InputSettlement;
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
    data: string,
    refused?: () => void
  ): void;
}
/** Implemented by the shim worker; production never loads the shim. */
export interface ConformancePort extends EditorPort {
  flush(): void;
}
