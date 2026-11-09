import init, {
  EditorSession,
} from '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  EditorInputMsg,
  type ISelectionMsg,
  QueryMsg,
  QueryReplyMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '../abi.generated';
import { emptyInput } from '../input';
import { decodeOutput } from '../output';

/** A keyboard host for the real production WASM; Rust owns history and selection. */
export async function historyFixture(codeSubtree = false) {
  await init();
  const session = EditorSession.create(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'history-fixture',
      session: crypto.randomUUID(),
      user: 'fixture-user',
      peers: [7n, 8n, 9n],
      access: Access.Edit,
      transport: Transport.None,
      durable: false,
      chatter: false,
      headless: false,
      viewEngine: 1,
      viewOs: 0,
      token: '',
      traceparent: '',
      coalesce: 25,
      snapshotInterval: 0,
      observed: [],
    }),
    0,
    0
  );
  let tick = 0;
  let selection: ISelectionMsg | undefined;
  const drain = () => {
    const bytes = session.takeOutput();
    if (bytes.length === 0) return;
    const output = decodeOutput(bytes);
    for (const effect of output.viewEffects) {
      if (effect.kind === 2)
        throw new Error(`native history error: ${effect.code}`);
      if (effect.kind === 6 && effect.code === 0) selection = effect.selection;
    }
  };
  const input = (kind: number) => {
    session.input(SessionInputMsg.encode(emptyInput(kind)), ++tick, tick);
    drain();
  };
  input(0);
  input(1);
  session.input(
    SessionInputMsg.encode({
      ...emptyInput(2),
      editor: EditorInputMsg.fromEditorSetState({
        json: JSON.stringify({
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: codeSubtree ? [] : [{ type: 'text', text: 'か' }],
              },
            ],
          },
        }),
      }),
    }),
    ++tick,
    tick
  );
  drain();
  const query = (kind: number, text = '') =>
    QueryReplyMsg.decode(
      session.query(QueryMsg.encode({ kind, key: 0, text, flags: 0 }))
    );
  const key = query(4, codeSubtree ? 'paragraph' : 'text').keys[0];
  const offset = codeSubtree ? 0 : 1;
  const pointType = codeSubtree ? 1 : 0;
  session.selectionFromView(
    key,
    offset,
    pointType,
    key,
    offset,
    pointType,
    ++tick
  );
  drain();
  session.command(12, 0, 0, undefined, ++tick);
  drain();
  if (codeSubtree) {
    session.input(
      SessionInputMsg.encode({
        ...emptyInput(2),
        editor: EditorInputMsg.fromEditorSetState({
          json: JSON.stringify({
            root: {
              type: 'root',
              children: [
                {
                  type: 'code',
                  children: [{ type: 'text', text: 'const localValue = 1;' }],
                },
                { type: 'paragraph', children: [] },
              ],
            },
          }),
        }),
      }),
      ++tick,
      tick
    );
    drain();
    const leaf = query(4, 'text').keys[0];
    session.selectionFromView(leaf, 21, 0, leaf, 21, 0, ++tick);
    drain();
  }
  const host = document.createElement('button');
  host.type = 'button';
  host.id = 'history-keyboard';
  host.textContent = 'Keyboard history';
  document.body.append(host);
  host.addEventListener('keydown', (event) => {
    let code = 0;
    if (event.key === 'Enter') code = 3;
    else if (event.ctrlKey && event.key.toLowerCase() === 'z')
      code = event.shiftKey ? 14 : 13;
    else if (event.ctrlKey && event.key === 'y') code = 14;
    else if (!event.ctrlKey && !event.metaKey && event.key.length === 1) {
      event.preventDefault();
      session.command(1, 0, 0, event.key, ++tick);
      drain();
      return;
    }
    if (!code) return;
    event.preventDefault();
    session.keyDown(
      0,
      (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 4 : 0),
      code,
      event.key,
      ++tick
    );
    drain();
  });
  return {
    clearHistory() {
      session.command(12, 0, 0, undefined, ++tick);
      drain();
    },
    snapshot() {
      if (!selection || selection.kind !== 2)
        throw new Error('missing native range selection');
      const ids = new Map<number, string>();
      for (const type of ['root', 'paragraph', 'text']) {
        const nodes = query(4, type);
        nodes.keys.forEach((key, index) => {
          ids.set(key, JSON.parse(nodes.nodes[index]).$?.id);
        });
      }
      const endpoint = (point: ISelectionMsg['anchor']) => {
        const id = ids.get(point.key);
        if (!id) throw new Error('missing durable point identity');
        return { id, kind: point.type, offset: point.offset };
      };
      return {
        content: query(7).text,
        anchor: endpoint(selection.anchor),
        focus: endpoint(selection.focus),
      };
    },
    close() {
      session.free();
      host.remove();
    },
  };
}
