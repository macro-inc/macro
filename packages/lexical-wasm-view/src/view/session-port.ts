import {
  Access,
  ClipboardDomMsg,
  EditorInputMsg,
  FLAG_HANDLED,
  type IQueryMsg,
  type ISelectionChangeMsg,
  type ISelectionMsg,
  ListenerTableMsg,
  QueryMsg,
  QueryReplyMsg,
  SelectionMsg,
  SessionInputMsg,
  TypeTableMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type {
  CommentMarkAction,
  CommentMarkReply,
  FlushReply,
  SessionExecutor,
  SyncEntrySchedule,
} from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { serializeClipboardDom } from './clipboard-dom';
import {
  type CommentSelection,
  encodeCommentSelectionCursors,
  parseCommentSelection,
} from './comment-selection';
import { InputCommitCorrelationExhausted } from './input-commit-correlation';
import {
  claimInputCommitObservation,
  type InputCommitEvidence,
  type InputCommitFailure,
  type InputCommitObservation,
  InputCommitUnavailableError,
} from './input-commit-observation';
import type { NativeCommandKey } from './native-enter';
import type { NativeEnterBinding } from './native-enter-output';
import { assertNativeSessionReceiverAdmission } from './native-session-guard';
import type {
  EditorPort,
  InputSettlement,
  NativeBlockNavigationPort,
  NativeEnterPort,
  NativeEscapePort,
  ProgrammaticApplicationAdmissionOptions,
  ProgrammaticApplicationInput,
  ProgrammaticApplicationOptions,
  SyncApplicationOptions,
  SyncInputOptions,
  TextFromView,
  ViewSink,
} from './port';
import type { EditorThemeClasses } from './registry';
import { executeSyncInput } from './sync-input';
import type { Point, TypeRow, ViewSelection } from './types';

export function selectionMessage(selection: ViewSelection): ISelectionMsg {
  const empty = { key: 0, offset: 0, type: 0 };
  const result: ISelectionMsg = {
    kind: 0,
    anchor: empty,
    focus: empty,
    nodes: [],
    table: 0,
    dirty: false,
  };
  if (selection.kind === 'none') return { ...result, kind: 1 };
  if (selection.kind === 'range')
    return {
      ...result,
      kind: 2,
      dirty: selection.dirty ?? false,
      anchor: {
        ...selection.anchor,
        type: selection.anchor.type === 'text' ? 0 : 1,
      },
      focus: {
        ...selection.focus,
        type: selection.focus.type === 'text' ? 0 : 1,
      },
    };
  if (selection.kind === 'node')
    return { ...result, kind: 3, nodes: [...selection.keys] };
  if (selection.kind === 'table')
    return {
      ...result,
      kind: 4,
      table: selection.table,
      anchor: { key: selection.anchorCell, offset: 0, type: 1 },
      focus: { key: selection.focusCell, offset: 0, type: 1 },
    };
  return result;
}

/** Executes inputs through the existing serialized host-I/O executor. */
export class SessionPort implements EditorPort {
  readonly nativeEnter: NativeEnterPort | undefined;
  readonly nativeEscape: NativeEscapePort | undefined;
  readonly nativeBlockNavigation: NativeBlockNavigationPort | undefined;
  constructor(
    private readonly executor: Pick<
      SessionExecutor<EditorSession>,
      'session' | 'run' | 'now'
    > &
      Partial<
        Pick<
          SessionExecutor<EditorSession>,
          'runSync' | 'tryRunSync' | 'runSettled' | 'comment' | 'flush'
        >
      >,
    private readonly view: ViewSink,
    private readonly debug = import.meta.env.DEV,
    private readonly commands?: NativeEnterBinding
  ) {
    if (commands) {
      if (!executor.runSync)
        throw new Error('Native Enter requires synchronous executor admission');
      const { dispatcher, owner } = commands;
      const createKeyPort = (key: NativeCommandKey): NativeEnterPort => ({
        register: (listener, priority, identity) => {
          commands.output.assertAttached();
          return dispatcher.register(
            executor.session,
            owner,
            listener,
            priority,
            identity,
            key
          );
        },
        hasListeners: () => dispatcher.hasListeners(owner, key),
        scope: () => dispatcher.current(owner),
        pendingSelection: () => dispatcher.pendingSelection(owner),
        pendingText: (key) => dispatcher.pendingText(owner, key),
        pendingOwnJSON: (key) => dispatcher.pendingOwnJSON(owner, key),
        takeFailure: () => commands.output.takeFailure(),
        dispatchScoped: (input) => {
          commands.output.assertAttached();
          return dispatcher.dispatchScoped(owner, input);
        },
        dispose: () => dispatcher.unregisterOwner(executor.session, owner, key),
        dispatch: () => {
          commands.output.assertAttached();
          if (dispatcher.current(owner))
            return key === 'Enter'
              ? dispatcher.enterScoped(owner)
              : dispatcher.escapeScoped(owner);
          commands.output.assertLocalAdmission();
          let handled: boolean | undefined;
          const run = executor.runSync;
          if (!run)
            throw new Error('Synchronous executor admission is unavailable');
          run.call(
            executor,
            () =>
              key === 'Enter'
                ? executor.session.viewCommandEnter(executor.now(), Date.now())
                : executor.session.viewCommandEscape(
                    executor.now(),
                    Date.now()
                  ),
            (flags) => {
              handled = Boolean(flags & FLAG_HANDLED);
            }
          );
          if (handled === undefined)
            throw new Error('Synchronous Enter completed without native flags');
          return handled;
        },
      });
      this.nativeEnter = createKeyPort('Enter');
      if (dispatcher.supportsEscape)
        this.nativeEscape = createKeyPort('Escape');
      if (dispatcher.supportsBlockNavigation) {
        this.nativeBlockNavigation = {
          register: (down, listener) => {
            commands.output.assertAttached();
            return dispatcher.register(
              executor.session,
              owner,
              listener,
              1,
              listener,
              down ? 'ArrowDown' : 'ArrowUp'
            );
          },
          prepare: () => dispatcher.prepareBlockNavigation(owner),
          block: (plan) => dispatcher.blockNavigationBlock(owner, plan),
          cancel: (plan) => dispatcher.cancelBlockNavigation(owner, plan),
          complete: (plan, rects) =>
            dispatcher.completeBlockNavigation(owner, plan, rects),
          dispose: () => {
            dispatcher.unregisterOwner(executor.session, owner, 'ArrowUp');
            dispatcher.unregisterOwner(executor.session, owner, 'ArrowDown');
          },
          hasListeners: () =>
            dispatcher.hasListeners(owner, 'ArrowUp') ||
            dispatcher.hasListeners(owner, 'ArrowDown'),
        };
      }
    }
  }
  private assertRootAdmission(): void {
    assertNativeSessionReceiverAdmission(this.executor.session);
    this.commands?.output.assertLocalAdmission();
  }
  types(): readonly TypeRow[] {
    this.assertRootAdmission();
    return TypeTableMsg.decode(this.executor.session.typeTable()).rows.map(
      (row) => {
        const kind =
          row.kind === 1
            ? 'element'
            : row.kind === 2
              ? 'text'
              : row.kind === 3
                ? 'decorator'
                : row.kind === 4
                  ? 'linebreak'
                  : null;
        if (!kind) throw new Error('Unknown node kind: ' + row.kind);
        return {
          index: row.index,
          name: row.name,
          kind,
          flags:
            row.flags & 1
              ? {
                  isInline: Boolean(row.flags & 2),
                  canInsertTextBefore: Boolean(row.flags & 4),
                  canInsertTextAfter: Boolean(row.flags & 8),
                  isKeyboardSelectable: Boolean(row.flags & 16),
                  isIsolated: Boolean(row.flags & 32),
                  isShadowRoot: Boolean(row.flags & 64),
                }
              : undefined,
        };
      }
    );
  }
  listeners(): ReadonlyMap<string, number> {
    this.assertRootAdmission();
    const bytes = this.executor.session.listenerTable();
    const token = this.commands?.dispatcher.guard.completedEntryToken();
    const table = ListenerTableMsg.decode(bytes);
    if (token !== undefined)
      this.commands?.output.acceptColdListenerTable(table, token);
    return new Map(table.rows.map((row) => [row.command, row.priority]));
  }
  needsKeyDown(key: string): boolean | undefined {
    return this.commands?.output.needsKeyDown(key);
  }
  listenerLevels(command: string, key?: string): number | undefined {
    return this.commands?.output.listenerLevels(command, key);
  }
  debugInsertion(
    selection: ViewSelection,
    format: number,
    style: string,
    text: string,
    facts: number
  ): boolean | undefined {
    this.assertRootAdmission();
    if (!this.debug) return undefined;
    return this.executor.session.debugInsertion(
      SelectionMsg.encode(selectionMessage(selection)),
      format,
      style,
      text,
      facts
    );
  }
  /**
   * DOM-origin admission. A live demotion reaches the session before the UI
   * editability effect, so a DOM caller passes `refused` and current authority
   * is checked inside the queued entry. A refusal makes no session call, runs
   * no completion and reports only through `refused`, so callers neither
   * acknowledge DOM text nor run fallback listeners that could write.
   */
  private sessionEditEntry<T>(
    call: () => T,
    refused: (() => void) | undefined
  ): { call: () => T | 0; refused: () => boolean } {
    if (!refused) return { call, refused: () => false };
    let entryRefused = false;
    return {
      call: () => {
        if (this.effectiveAccess() !== Access.Edit) {
          entryRefused = true;
          refused();
          return 0;
        }
        return call();
      },
      refused: () => entryRefused,
    };
  }
  textFromView(input: TextFromView, refused?: () => void): void {
    this.assertRootAdmission();
    const session = this.executor.session;
    let acknowledgement: object | undefined;
    const entry = this.sessionEditEntry(() => {
      const flags = session.textFromView(
        input.key,
        input.text,
        input.anchorOffset,
        input.focusOffset,
        input.selectionKind === 'keep'
          ? 1
          : input.selectionKind === 'none'
            ? 2
            : 0,
        input.compositionEnd ? 1 : 0,
        input.compositionData,
        this.executor.now()
      );
      acknowledgement = this.commands?.output.captureAcknowledgement(flags);
      return flags;
    }, refused);
    this.executor.run(entry.call, (flags) => {
      if (entry.refused()) return;
      const accepted =
        this.commands?.output.consumeAcknowledgement(acknowledgement, flags) ??
        false;
      // Preserve legacy zero, or the exact current qualified metadata-only echo.
      if (flags === 0 || accepted) this.view.acknowledgeText(input);
      if (this.debug) {
        const expected = session.nodeText(input.key);
        const actual = this.view.text(input.key) ?? '';
        if (actual !== expected)
          throw new Error(
            `TextFromView mirror divergence at key ${input.key}: mirror length=${actual.length}, Rust length=${expected.length}`
          );
      }
    });
  }
  selectionFromView(
    selection: ViewSelection,
    change?: ISelectionChangeMsg
  ): void {
    const commands = this.commands;
    if (commands?.dispatcher.current(commands.owner)) {
      commands.output.assertAttached();
      if (change)
        throw new Error('Scoped selection does not accept root input metadata');
      commands.dispatcher.setPendingSelection(
        commands.owner,
        selectionMessage(selection)
      );
      return;
    }
    this.assertRootAdmission();
    let acknowledgement: object | undefined;
    if (change || selection.kind !== 'range' || selection.dirty) {
      const editor = EditorInputMsg.fromEditorSelection({
        selection: selectionMessage(selection),
        change: change ?? {},
      });
      this.executor.run(
        () => {
          const flags = this.executor.session.input(
            SessionInputMsg.encode({ ...emptyInput(2), editor }),
            this.executor.now(),
            Date.now()
          );
          acknowledgement = commands?.output.captureAcknowledgement(flags);
          return flags;
        },
        (flags) => {
          const accepted =
            commands?.output.consumeAcknowledgement(acknowledgement, flags) ??
            false;
          if ((flags === 0 || accepted) && selection.kind !== 'keep')
            this.view.acknowledgeSelection(selection);
        }
      );
    } else if (selection.kind === 'range') {
      const { anchor, focus } = selection;
      this.executor.run(
        () => {
          const flags = this.executor.session.selectionFromView(
            anchor.key,
            anchor.offset,
            anchor.type === 'text' ? 0 : 1,
            focus.key,
            focus.offset,
            focus.type === 'text' ? 0 : 1,
            this.executor.now()
          );
          acknowledgement = commands?.output.captureAcknowledgement(flags);
          return flags;
        },
        (flags) => {
          const accepted =
            commands?.output.consumeAcknowledgement(acknowledgement, flags) ??
            false;
          if (flags === 0 || accepted)
            this.view.acknowledgeSelection(selection);
        }
      );
    }
  }

  command(
    code: number,
    a = 0,
    b = 0,
    text?: string,
    refused?: () => void
  ): boolean | undefined {
    this.assertRootAdmission();
    let handled: boolean | undefined;
    const entry = this.sessionEditEntry(
      () =>
        this.executor.session.command(code, a, b, text, this.executor.now()),
      refused
    );
    this.executor.run(entry.call, (flags) => {
      if (entry.refused()) return;
      handled = Boolean(flags & FLAG_HANDLED);
    });
    return handled;
  }
  keyDown(
    code: number,
    mods: number,
    routed: number,
    key: string,
    selection: ViewSelection,
    event?: KeyboardEvent,
    refused?: () => void
  ): boolean | undefined {
    this.assertRootAdmission();
    let handled: boolean | undefined;
    const anchor =
      selection.kind === 'range'
        ? selection.anchor
        : { key: 0, offset: 0, type: 'text' };
    const focus = selection.kind === 'range' ? selection.focus : anchor;
    const call = () =>
      this.executor.session.keyDown(
        code,
        mods,
        routed,
        key,
        anchor.key,
        anchor.offset,
        anchor.type === 'text' ? 0 : 1,
        focus.key,
        focus.offset,
        focus.type === 'text' ? 0 : 1,
        selection.kind === 'range' ? 0 : selection.kind === 'none' ? 2 : 1,
        this.executor.now()
      );
    let entry = this.sessionEditEntry(call, refused);
    const after = (flags: number) => {
      if (entry.refused()) return;
      handled = Boolean(flags & FLAG_HANDLED);
    };
    if (
      (key === 'Enter' ||
        (key === 'Escape' && this.nativeEscape) ||
        ((key === 'ArrowUp' || key === 'ArrowDown') &&
          this.nativeBlockNavigation)) &&
      this.commands
    ) {
      if (!event)
        throw new Error('Native keyboard command requires its actual event');
      const run = this.executor.runSync;
      if (!run)
        throw new Error('Synchronous executor admission is unavailable');
      const { dispatcher, owner } = this.commands;
      // Authority is checked before the keyboard scope is entered.
      entry = this.sessionEditEntry(
        () => dispatcher.withKeyboardEvent(owner, event, call),
        refused
      );
      run.call(this.executor, entry.call, after);
    } else this.executor.run(entry.call, after);
    return handled;
  }
  private prepareInput(editor: EditorInputMsg, event?: KeyboardEvent) {
    const call = () =>
      this.executor.session.input(
        SessionInputMsg.encode({ ...emptyInput(2), editor }),
        this.executor.now(),
        Date.now()
      );
    if (
      (event?.key === 'Enter' ||
        (event?.key === 'Escape' && this.nativeEscape) ||
        ((event?.key === 'ArrowUp' || event?.key === 'ArrowDown') &&
          this.nativeBlockNavigation)) &&
      this.commands
    ) {
      const { dispatcher, owner } = this.commands;
      return {
        call: () => dispatcher.withKeyboardEvent(owner, event, call),
        synchronous: true,
      };
    }
    return { call, synchronous: false };
  }
  input(
    editor: EditorInputMsg,
    after?: (handled: boolean) => void,
    event?: KeyboardEvent,
    refused?: () => void
  ): void {
    this.assertRootAdmission();
    const operation = this.prepareInput(editor, event);
    const entry = this.sessionEditEntry(operation.call, refused);
    const complete = (flags: number) => {
      if (entry.refused()) return;
      after?.(Boolean(flags & FLAG_HANDLED));
    };
    if (operation.synchronous) {
      const run = this.executor.runSync;
      if (!run)
        throw new Error('Synchronous executor admission is unavailable');
      run.call(this.executor, entry.call, complete);
    } else this.executor.run(entry.call, complete);
  }
  inputApplicationSync<Proof>(
    factory: () => ProgrammaticApplicationInput,
    options: SyncApplicationOptions<Proof>
  ): SyncEntrySchedule {
    return this.syncInput(
      (policy, generation) => {
        const application = factory();
        if (application.generation !== generation)
          throw new Error(
            'Application input generation changed during preparation'
          );
        if (
          policy === 'table-selection' &&
          (application.name !== 'group-b.table-pointer-down' ||
            options.event !== undefined ||
            application.selection.kind !== 0)
        )
          throw new Error(
            'Table pointer input requires its closed KeepModel command'
          );
        const event = options.event;
        return EditorInputMsg.fromEditorApplication({
          ...application,
          keyboard: event !== undefined,
          key: event?.key ?? '',
          mods: event
            ? Number(event.shiftKey) |
              (Number(event.altKey) << 1) |
              (Number(event.ctrlKey) << 2) |
              (Number(event.metaKey) << 3) |
              (Number(event.repeat) << 4) |
              (Number(event.isComposing) << 5)
            : 0,
          code: event?.keyCode ?? 0,
        });
      },
      options,
      () => options.admission,
      options.event
    );
  }

  pasteSync<Proof>(
    factory: () => EditorInputMsg,
    options: SyncInputOptions<Proof>
  ): SyncEntrySchedule {
    return this.syncInput(
      () => {
        const input = factory();
        if (!input.isEditorPaste() && !input.isEditorPasteWithIntent())
          throw new Error(
            'Paste preparation must return the existing typed paste input'
          );
        return input;
      },
      options,
      () => 'session-edit'
    );
  }

  private syncInput<Proof>(
    factory: (
      policy: 'session-edit' | 'table-selection',
      generation: number
    ) => EditorInputMsg,
    options: SyncInputOptions<Proof>,
    admission: () => 'session-edit' | 'table-selection',
    event?: KeyboardEvent
  ): SyncEntrySchedule {
    return executeSyncInput(
      {
        port: this,
        executor: this.executor,
        commands: this.commands,
        assertRootAdmission: () => this.assertRootAdmission(),
        effectiveAccess: () => this.effectiveAccess(),
        invoke: (call) => {
          if (
            (event?.key === 'Enter' ||
              (event?.key === 'Escape' && this.nativeEscape) ||
              ((event?.key === 'ArrowUp' || event?.key === 'ArrowDown') &&
                this.nativeBlockNavigation)) &&
            this.commands
          ) {
            return this.commands.dispatcher.withKeyboardEvent(
              this.commands.owner,
              event,
              call
            );
          }
          return call();
        },
      },
      factory,
      options,
      admission
    );
  }

  /** Root admission only; a native dispatcher callback must use its issued scope. */
  inputSettled(
    factory: () => ProgrammaticApplicationInput,
    options?: ProgrammaticApplicationOptions
  ): Promise<InputSettlement>;
  inputSettled(
    editor: EditorInputMsg,
    event?: KeyboardEvent
  ): Promise<InputSettlement>;
  inputSettled(
    editor: EditorInputMsg | (() => ProgrammaticApplicationInput),
    eventOrOptions?: KeyboardEvent | ProgrammaticApplicationOptions
  ): Promise<InputSettlement> {
    return this.settleInput(editor, eventOrOptions);
  }
  /** Authority refusal is a settled cancellation, independent of UI editability. */
  inputSettledIfSessionEdit(
    factory: () => ProgrammaticApplicationInput,
    options?: ProgrammaticApplicationAdmissionOptions
  ): Promise<InputSettlement> {
    this.assertRootAdmission();
    const admitEntry = options?.admit;
    if (options !== undefined && typeof admitEntry !== 'function')
      throw new TypeError('Entry admission requires a callback');
    return this.settleInput(
      factory,
      options,
      () => this.effectiveAccess() === Access.Edit,
      admitEntry
    );
  }
  /** Synchronous Edit-admitted application for callers that must settle in
   *  their own task (AI edit onOps). The entry runs in this call's drain;
   *  throws before the factory when the executor is busy or has queued work
   *  (executor runSettled `synchronous`). A closed, closing or unauthorized
   *  session settles cancelled before the factory runs. A throw after the
   *  drain started can follow an applied input: work queued behind this entry
   *  (listeners) rethrows its own error after this entry settled. */
  inputNowIfSessionEdit(
    factory: () => ProgrammaticApplicationInput,
    options?: ProgrammaticApplicationAdmissionOptions
  ): InputSettlement {
    this.assertRootAdmission();
    const admitEntry = options?.admit;
    if (options !== undefined && typeof admitEntry !== 'function')
      throw new TypeError('Entry admission requires a callback');
    let settled: InputSettlement | undefined;
    this.enqueueSettled(
      factory,
      options,
      () => this.effectiveAccess() === Access.Edit,
      admitEntry,
      true,
      (result) => {
        settled = result;
      }
    );
    if (settled === undefined)
      throw new Error(
        'Synchronous application input did not settle in its drain; it may have been applied'
      );
    return settled;
  }
  private settleInput(
    editor: EditorInputMsg | (() => ProgrammaticApplicationInput),
    eventOrOptions?:
      | KeyboardEvent
      | ProgrammaticApplicationOptions
      | ProgrammaticApplicationAdmissionOptions,
    admit?: () => boolean,
    admitEntry?: () => boolean
  ): Promise<InputSettlement> {
    let resolve!: (result: InputSettlement) => void;
    const pending = new Promise<InputSettlement>((complete) => {
      resolve = complete;
    });
    this.enqueueSettled(
      editor,
      eventOrOptions,
      admit,
      admitEntry,
      false,
      resolve
    );
    return pending;
  }
  private enqueueSettled(
    editor: EditorInputMsg | (() => ProgrammaticApplicationInput),
    eventOrOptions:
      | KeyboardEvent
      | ProgrammaticApplicationOptions
      | ProgrammaticApplicationAdmissionOptions
      | undefined,
    admit: (() => boolean) | undefined,
    admitEntry: (() => boolean) | undefined,
    synchronousEntry: boolean,
    resolve: (result: InputSettlement) => void
  ): void {
    this.assertRootAdmission();
    const run = this.executor.runSettled;
    if (!run) throw new Error('Per-input executor settlement is unavailable');
    if (admit && typeof editor !== 'function')
      throw new Error('Conditional application inputs require a factory');
    let after: ((handled: boolean) => void) | undefined;
    let requested: InputCommitObservation | undefined;
    let event: KeyboardEvent | undefined;
    if (typeof editor === 'function') {
      if (eventOrOptions !== undefined) {
        if (
          !('after' in eventOrOptions) &&
          !('mainCommit' in eventOrOptions) &&
          !('admit' in eventOrOptions)
        )
          throw new Error(
            'Deferred application inputs cannot carry DOM events'
          );
        const capturedAfter =
          'after' in eventOrOptions ? eventOrOptions.after : undefined;
        if (capturedAfter !== undefined && typeof capturedAfter !== 'function')
          throw new TypeError('Application completion requires a callback');
        after = capturedAfter;
        requested =
          'mainCommit' in eventOrOptions
            ? eventOrOptions.mainCommit
            : undefined;
      }
    } else if (eventOrOptions !== undefined) {
      if (
        'after' in eventOrOptions ||
        'mainCommit' in eventOrOptions ||
        'admit' in eventOrOptions
      )
        throw new Error('Completion options require an application factory');
      event = eventOrOptions;
    }
    const observerCommands = this.commands;
    if (requested !== undefined && !observerCommands)
      throw new Error(
        'Input commit observation requires its native lifetime fence'
      );
    const expectedOwner =
      requested === undefined ? undefined : observerCommands?.owner;
    if (requested !== undefined && typeof expectedOwner !== 'bigint')
      throw new Error(
        'Input commit observation requires its actual owner binding'
      );
    const observerSession =
      requested === undefined ? undefined : this.executor.session;
    const binding =
      observerSession === undefined || expectedOwner === undefined
        ? undefined
        : observerCommands?.dispatcher.inputCommitBinding(
            observerSession,
            expectedOwner
          );
    // Shape/root failures above leave a fresh handle unbound. Claim atomically
    // before enqueue, which can synchronously execute or reenter this Port.
    const observation =
      requested === undefined
        ? undefined
        : claimInputCommitObservation(requested);
    let copied: InputCommitEvidence | undefined;
    let receiverInvoked = false;
    const secondary: InputCommitFailure[] = [];
    const finishObservation = (evidence: InputCommitEvidence) => {
      copied = evidence;
      return observation?.finish(evidence);
    };
    if (observation && !binding) {
      const unavailable = Object.freeze({
        status: 'unavailable',
        reason: 'unsupported-profile',
        receiverNeverCalled: true,
      } satisfies InputCommitEvidence);
      // No entry/afterDrain exists here: do not run a listener that could defer
      // teardown. This is explicit profile refusal, never a fallback input.
      finishObservation(unavailable);
      throw new InputCommitUnavailableError(unavailable);
    }
    const operation =
      typeof editor === 'function'
        ? {
            synchronous: synchronousEntry,
            call: () => {
              if (observation) {
                if (
                  !observerSession ||
                  expectedOwner === undefined ||
                  this.executor.session !== observerSession ||
                  observerCommands?.dispatcher.inputCommitBinding(
                    observerSession,
                    expectedOwner
                  ) !== binding
                )
                  throw new Error(
                    'Observed native receiver changed before entry'
                  );
              }
              const application = editor();
              const message = EditorInputMsg.fromEditorApplication({
                name: application.name,
                json: application.json,
                generation: application.generation,
                selection: application.selection,
                keyboard: false,
                key: '',
                mods: 0,
                code: 0,
              });
              if (!observation) return this.prepareInput(message).call();
              if (!binding)
                throw new Error('Observed native binding disappeared');
              const bytes = SessionInputMsg.encode({
                ...emptyInput(2),
                editor: message,
              }).slice();
              const now = this.executor.now();
              const wall = Date.now();
              const receiver = this.executor.session;
              if (
                receiver !== observerSession ||
                expectedOwner === undefined ||
                observerCommands?.dispatcher.inputCommitBinding(
                  receiver,
                  expectedOwner
                ) !== binding
              )
                throw new Error(
                  'Observed native receiver changed during materialization'
                );
              receiverInvoked = true;
              let result: ReturnType<typeof binding.invoke>;
              try {
                // All user callbacks/getters are complete. The frozen binding
                // mints immediately before calling its captured guarded input.
                result = binding.invoke(receiver, bytes, now, wall);
              } catch (error) {
                if (error instanceof InputCommitCorrelationExhausted) {
                  receiverInvoked = false;
                  const unavailable = Object.freeze({
                    status: 'unavailable',
                    reason: 'correlation-exhausted',
                    receiverNeverCalled: true,
                  } satisfies InputCommitEvidence);
                  finishObservation(unavailable);
                  throw new InputCommitUnavailableError(unavailable);
                }
                throw error;
              }
              const notify = finishObservation(result.evidence);
              secondary.push(...result.secondary);
              if (result.released && notify) {
                try {
                  if (!observerCommands)
                    throw new Error('Native observation fence disappeared');
                  observerCommands.dispatcher.withPureInputCommitObserver(
                    receiver,
                    notify
                  );
                } catch (error) {
                  secondary.push(Object.freeze({ error }));
                }
              }
              if (result.nativeFailure !== undefined)
                throw result.nativeFailure.error;
              if (result.flags === undefined)
                throw new Error(
                  'Observed native input completed without flags'
                );
              return result.flags;
            },
          }
        : this.prepareInput(editor, event);
    try {
      run.call(
        this.executor,
        operation.call,
        (result) => {
          if (observation?.pending()) {
            if (receiverInvoked) {
              finishObservation(
                Object.freeze({
                  status: 'unavailable',
                  reason: 'receipt-read',
                  receiverNeverCalled: false,
                  failure: Object.freeze({
                    error:
                      result.status === 'error'
                        ? result.error
                        : new Error(
                            'Observed receiver settled without copied evidence'
                          ),
                  }),
                })
              );
            } else {
              const cause: Extract<
                InputCommitEvidence,
                { status: 'not-entered' }
              >['cause'] =
                result.status === 'success'
                  ? {
                      status: 'error',
                      error: new Error('Observed input did not enter native'),
                    }
                  : result.status === 'error'
                    ? { status: 'error', error: result.error }
                    : { status: 'cancelled', reason: result.reason };
              finishObservation({
                status: 'not-entered',
                cause: Object.freeze(cause),
              });
            }
          }
          const settled: InputSettlement =
            result.status === 'success'
              ? {
                  status: 'success',
                  handled: Boolean(result.flags & FLAG_HANDLED),
                }
              : result;
          if (observation) {
            resolve({
              ...(settled.status === 'success' && secondary[0] !== undefined
                ? { status: 'error', error: secondary[0].error }
                : settled),
              mainCommit: copied,
            });
            for (const failure of secondary) {
              try {
                Telemetry.error(failure.error, {
                  surface: 'editor.input-observation.secondary',
                });
              } catch {
                /* Optional reporting cannot replace this entry's primary error. */
              }
            }
          } else resolve(settled);
        },
        {
          admit,
          admitEntry,
          synchronous: operation.synchronous,
          after: after
            ? (flags) => after(Boolean(flags & FLAG_HANDLED))
            : undefined,
        }
      );
    } catch (error) {
      if (observation?.pending()) {
        if (receiverInvoked)
          finishObservation(
            Object.freeze({
              status: 'unavailable',
              reason: 'receipt-read',
              receiverNeverCalled: false,
              failure: Object.freeze({ error }),
            })
          );
        else
          finishObservation({
            status: 'not-entered',
            cause: Object.freeze({ status: 'error', error }),
          });
      }
      throw error;
    }
  }
  /** Current native authority, independent of local editability and initial config. */
  effectiveAccess(): Access {
    const access = this.executor.session.effectiveAccess();
    if (
      access !== Access.Read &&
      access !== Access.CommentOnly &&
      access !== Access.Edit
    )
      throw new Error('Unknown effective session access');
    return access;
  }
  /** Derived media normalization is admitted only under current authority in this queue turn. */
  inputIfSessionEdit(
    editor: EditorInputMsg,
    after?: (handled: boolean) => void
  ): void {
    this.assertRootAdmission();
    this.executor.run(
      () => {
        if (this.effectiveAccess() !== Access.Edit) return 0;
        return this.executor.session.input(
          SessionInputMsg.encode({ ...emptyInput(2), editor }),
          this.executor.now(),
          Date.now()
        );
      },
      (flags) => after?.(Boolean(flags & FLAG_HANDLED))
    );
  }
  clipboard(kind: number, theme: EditorThemeClasses, document: Document) {
    this.assertRootAdmission();
    const data = ClipboardDomMsg.decode(
      this.executor.session.clipboardDom(kind, JSON.stringify(theme))
    );
    return serializeClipboardDom(data, document);
  }
  /** Current durable selection cursors and their exact model text. */
  commentSelection(): CommentSelection | null {
    const reply = this.query({ kind: 8, key: 0, flags: 0, text: '' });
    return parseCommentSelection(reply.nodes, reply.text);
  }
  /** Current points of durable cursors; null when either no longer resolves. */
  resolveCommentSelection(
    selection: CommentSelection
  ): { readonly anchor: Point; readonly focus: Point } | null {
    const reply = this.query({
      kind: 12,
      key: 0,
      flags: 0,
      text: encodeCommentSelectionCursors(selection),
    });
    const [anchor, focus] = reply.points;
    if (!anchor || !focus) return null;
    const point = (value: (typeof reply.points)[number]): Point => ({
      key: value.key,
      offset: value.offset,
      type: value.type === 0 ? 'text' : 'element',
    });
    return { anchor: point(anchor), focus: point(focus) };
  }
  /** Source draft quote: current nonempty marked text, else durable range text.
   * Undefined is unavailable; an empty string is a resolved empty range.
   */
  commentDraftText(
    selection: CommentSelection,
    markId: string
  ): string | undefined {
    const reply = this.query({
      kind: 12,
      key: 0,
      flags: 0,
      text: encodeCommentSelectionCursors(selection, markId),
    });
    if (reply.count === 1) return reply.text;
    if (reply.count !== 0 || reply.text !== '')
      throw new Error('Invalid native comment draft text reply');
    return undefined;
  }
  /** Append local edits and resolve when they are delivered or cannot be. */
  flush(): Promise<FlushReply> {
    this.assertRootAdmission();
    const flush = this.executor.flush;
    if (!flush) throw new Error('Session flush is unavailable');
    return flush.call(this.executor);
  }
  /** Publish or remove an annotation from the session's isolated staging peer. */
  comment(
    markId: string,
    action: CommentMarkAction
  ): Promise<CommentMarkReply> {
    this.assertRootAdmission();
    const comment = this.executor.comment;
    if (!comment) throw new Error('Comment publication is unavailable');
    return comment.call(this.executor, markId, action);
  }
  query(query: IQueryMsg) {
    this.assertRootAdmission();
    return QueryReplyMsg.decode(
      this.executor.session.query(QueryMsg.encode(query))
    );
  }
  initialize(): void {
    this.assertRootAdmission();
    this.executor.run(() => {
      const out = decodeOutput(this.executor.session.initialize());
      this.view.apply(out.view, out.strings, out.viewEffects);
      return 0;
    });
  }
  setState(json: string): void {
    this.input(EditorInputMsg.fromEditorSetState({ json }));
  }
  composition(
    kind: number,
    key: number,
    text: string,
    anchor: number,
    focus: number,
    data: string,
    refused?: () => void
  ): void {
    this.assertRootAdmission();
    this.executor.run(
      this.sessionEditEntry(
        () =>
          this.executor.session.composition(
            kind,
            key,
            text,
            anchor,
            focus,
            data,
            this.executor.now()
          ),
        refused
      ).call
    );
  }
}
