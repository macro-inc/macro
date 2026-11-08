import {
  EditorInputMsg,
  FLAG_HANDLED,
  ClipboardMsg,
  QueryMsg,
  QueryReplyMsg,
  SelectionMsg,
  type IQueryMsg,
  ListenerTableMsg,
  SessionInputMsg,
  TypeTableMsg,
  type ISelectionMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { SessionExecutor } from '@macro-inc/collaboration/session/executor';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import type { EditorPort, TextFromView, ViewSink } from './port';
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
  constructor(
    private readonly executor: Pick<
      SessionExecutor<EditorSession>,
      'session' | 'run' | 'now'
    >,
    private readonly view: ViewSink,
    private readonly debug = import.meta.env.DEV
  ) {}
  types(): readonly TypeRow[] {
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
  selectionFromView(selection: ViewSelection): void {
    if (selection.kind === 'range') {
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
    } else
      this.input(
        EditorInputMsg.fromEditorSelection({
          selection: selectionMessage(selection),
          change: {},
        })
      );
  }
  command(code: number, a = 0, b = 0, text?: string): boolean | undefined {
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
    selection: ViewSelection
  ): boolean | undefined {
    let handled: boolean | undefined;
    const anchor =
      selection.kind === 'range'
        ? selection.anchor
        : { key: 0, offset: 0, type: 'text' };
    const focus = selection.kind === 'range' ? selection.focus : anchor;
    this.executor.run(
      () =>
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
        ),
      (flags) => {
        handled = Boolean(flags & FLAG_HANDLED);
      }
    );
    return handled;
  }
  input(editor: EditorInputMsg): void {
    this.executor.run(() =>
      this.executor.session.input(
        SessionInputMsg.encode({ ...emptyInput(2), editor }),
        this.executor.now(),
        Date.now()
      )
    );
  }
  clipboard(kind: number) {
    return ClipboardMsg.decode(this.executor.session.clipboard(kind));
  }
  query(query: IQueryMsg) {
    return QueryReplyMsg.decode(
      this.executor.session.query(QueryMsg.encode(query))
    );
  }
  initialize(): void {
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
