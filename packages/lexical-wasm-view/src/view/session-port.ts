import {
  Access,
  ClipboardMsg,
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
import type { SessionExecutor } from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import type { NativeEnterBinding } from './native-enter-output';
import { assertNativeSessionReceiverAdmission } from './native-session-guard';
import type {
  EditorPort,
  NativeEnterPort,
  TextFromView,
  ViewSink,
} from './port';
import type { TypeRow, ViewSelection } from './types';

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
  constructor(
    private readonly executor: Pick<
      SessionExecutor<EditorSession>,
      'session' | 'run' | 'now'
    > &
      Partial<Pick<SessionExecutor<EditorSession>, 'runSync'>>,
    private readonly view: ViewSink,
    private readonly debug = import.meta.env.DEV,
    private readonly commands?: NativeEnterBinding
  ) {
    if (commands) {
      if (!executor.runSync)
        throw new Error('Native Enter requires synchronous executor admission');
      const { dispatcher, owner } = commands;
      this.nativeEnter = {
        register: (listener, priority, identity) => {
          commands.output.assertAttached();
          return dispatcher.register(
            executor.session,
            owner,
            listener,
            priority,
            identity
          );
        },
        hasListeners: () => dispatcher.hasListeners(owner),
        scope: () => dispatcher.current(owner),
        pendingSelection: () => dispatcher.pendingSelection(owner),
        pendingText: (key) => dispatcher.pendingText(owner, key),
        pendingOwnJSON: (key) => dispatcher.pendingOwnJSON(owner, key),
        takeFailure: () => commands.output.takeFailure(),
        dispatchScoped: (input) => {
          commands.output.assertAttached();
          return dispatcher.dispatchScoped(owner, input);
        },
        dispose: () => dispatcher.unregisterOwner(executor.session, owner),
        dispatch: () => {
          commands.output.assertAttached();
          if (dispatcher.current(owner)) return dispatcher.enterScoped(owner);
          commands.output.assertLocalAdmission();
          let handled: boolean | undefined;
          const run = executor.runSync;
          if (!run)
            throw new Error('Synchronous executor admission is unavailable');
          run.call(
            executor,
            () => executor.session.viewCommandEnter(executor.now(), Date.now()),
            (flags) => {
              handled = Boolean(flags & FLAG_HANDLED);
            }
          );
          if (handled === undefined)
            throw new Error('Synchronous Enter completed without native flags');
          return handled;
        },
      };
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
    return new Map(
      ListenerTableMsg.decode(this.executor.session.listenerTable()).rows.map(
        (row) => [row.command, row.priority]
      )
    );
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
  textFromView(input: TextFromView): void {
    this.assertRootAdmission();
    const session = this.executor.session;
    this.executor.run(
      () =>
        session.textFromView(
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
        ),
      (flags) => {
        // Nonzero results have already applied authoritative ops through consume.
        // Zero alone proves that Rust accepted exactly the submitted DOM text.
        if (flags === 0) this.view.acknowledgeText(input);
        if (this.debug) {
          const expected = session.nodeText(input.key);
          const actual = this.view.text(input.key) ?? '';
          if (actual !== expected)
            throw new Error(
              `TextFromView mirror divergence at key ${input.key}: mirror length=${actual.length}, Rust length=${expected.length}`
            );
        }
      }
    );
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
    if (change || selection.kind !== 'range' || selection.dirty) {
      const editor = EditorInputMsg.fromEditorSelection({
        selection: selectionMessage(selection),
        change: change ?? {},
      });
      this.executor.run(
        () =>
          this.executor.session.input(
            SessionInputMsg.encode({ ...emptyInput(2), editor }),
            this.executor.now(),
            Date.now()
          ),
        (flags) => {
          if (flags === 0 && selection.kind !== 'keep')
            this.view.acknowledgeSelection(selection);
        }
      );
    } else if (selection.kind === 'range') {
      const { anchor, focus } = selection;
      this.executor.run(
        () =>
          this.executor.session.selectionFromView(
            anchor.key,
            anchor.offset,
            anchor.type === 'text' ? 0 : 1,
            focus.key,
            focus.offset,
            focus.type === 'text' ? 0 : 1,
            this.executor.now()
          ),
        (flags) => {
          if (flags === 0) this.view.acknowledgeSelection(selection);
        }
      );
    }
  }

  command(code: number, a = 0, b = 0, text?: string): boolean | undefined {
    this.assertRootAdmission();
    let handled: boolean | undefined;
    this.executor.run(
      () =>
        this.executor.session.command(code, a, b, text, this.executor.now()),
      (flags) => {
        handled = Boolean(flags & FLAG_HANDLED);
      }
    );
    return handled;
  }
  keyDown(
    code: number,
    mods: number,
    routed: number,
    key: string,
    selection: ViewSelection,
    event?: KeyboardEvent
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
    const after = (flags: number) => {
      handled = Boolean(flags & FLAG_HANDLED);
    };
    if (key === 'Enter' && this.commands) {
      if (!event)
        throw new Error('Native keyboard Enter requires its actual event');
      const run = this.executor.runSync;
      if (!run)
        throw new Error('Synchronous executor admission is unavailable');
      const { dispatcher, owner } = this.commands;
      run.call(
        this.executor,
        () => dispatcher.withKeyboardEvent(owner, event, call),
        after
      );
    } else this.executor.run(call, after);
    return handled;
  }
  input(
    editor: EditorInputMsg,
    after?: (handled: boolean) => void,
    event?: KeyboardEvent
  ): void {
    this.assertRootAdmission();
    const call = () =>
      this.executor.session.input(
        SessionInputMsg.encode({ ...emptyInput(2), editor }),
        this.executor.now(),
        Date.now()
      );
    const complete = (flags: number) => after?.(Boolean(flags & FLAG_HANDLED));
    if (event?.key === 'Enter' && this.commands) {
      const run = this.executor.runSync;
      if (!run)
        throw new Error('Synchronous executor admission is unavailable');
      const { dispatcher, owner } = this.commands;
      run.call(
        this.executor,
        () => dispatcher.withKeyboardEvent(owner, event, call),
        complete
      );
    } else this.executor.run(call, complete);
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
  clipboard(kind: number) {
    this.assertRootAdmission();
    return ClipboardMsg.decode(this.executor.session.clipboard(kind));
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
    data: string
  ): void {
    this.assertRootAdmission();
    this.executor.run(() =>
      this.executor.session.composition(
        kind,
        key,
        text,
        anchor,
        focus,
        data,
        this.executor.now()
      )
    );
  }
}
