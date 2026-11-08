import {
  EditorInputMsg,
  ListenerTableMsg,
  SessionInputMsg,
  TypeTableMsg,
  type ISelectionMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { SessionExecutor } from '@macro-inc/collaboration/session/executor';
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
        return { index: row.index, name: row.name, kind };
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
      this.executor.run(() =>
        this.executor.session.selectionFromView(
          anchor.key,
          anchor.offset,
          anchor.type === 'text' ? 0 : 1,
          focus.key,
          focus.offset,
          focus.type === 'text' ? 0 : 1,
          this.executor.now()
        )
      );
    } else
      this.input(
        EditorInputMsg.fromEditorSelection({
          selection: selectionMessage(selection),
          change: {},
        })
      );
  }
  command(code: number, a = 0, b = 0, text?: string): void {
    this.executor.run(() =>
      this.executor.session.command(code, a, b, text, this.executor.now())
    );
  }
  keyDown(code: number, mods: number, routed: number, key: string): void {
    this.executor.run(() =>
      this.executor.session.keyDown(
        code,
        mods,
        routed,
        key,
        this.executor.now()
      )
    );
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
