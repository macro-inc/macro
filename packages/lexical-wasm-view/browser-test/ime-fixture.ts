import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt/base64';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  TelemetryMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import {
  FromPeer,
  FromRemote,
} from '@macro-inc/collaboration/sync-service/generated/schema';
import { intoFrames } from '@macro-inc/collaboration/websocket/platform/framing/frames';
import { EditorView } from '../src/view/editor-view';
import { SessionPort } from '../src/view/session-port';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import type { ViewSink } from '../src/view/port';

await init();
const root = document.getElementById('editor');
if (!root) throw new Error('Missing IME root');
const server = new LoroDoc();
server.setPeerId(40n);
const map = server.getMap('root');
map.set('type', 'root');
map.set('version', 1);
map.set('format', '');
map.set('indent', 0);
map.set('direction', null);
const children = map.setContainer('children', new LoroMovableList());
const p = children.insertContainer(0, new LoroMap());
p.set('type', 'paragraph');
p.set('version', 1);
p.set('format', '');
p.set('indent', 0);
p.set('direction', null);
p.set('textFormat', 0);
p.set('textStyle', '');
const texts = p.setContainer('children', new LoroMovableList());
const text = texts.insertContainer(0, new LoroMap());
text.set('type', 'text');
text.set('version', 1);
text.set('format', 0);
text.set('detail', 0);
text.set('mode', 'normal');
text.set('style', '');
const remoteText = text.setContainer('text', new LoroText());
remoteText.insert(0, 'a');
server.commit();
const seed = server.export({ mode: 'snapshot' });
server.setPeerId(60n);
let now = 0;
const session = EditorSession.create(
  ABI_MAJOR,
  SessionConfigMsg.encode({
    doc: 'ime-fixture',
    session: '00000000-0000-0000-0000-000000000001',
    user: 'fixture-user',
    peers: [50n, 51n, 52n],
    access: Access.Edit,
    transport: Transport.Direct,
    durable: false,
    chatter: false,
    headless: false,
    viewEngine: 1,
    viewOs: 0,
    token: 'fixture-token',
    traceparent: '',
    coalesce: 25,
    snapshotInterval: 0,
    observed: [],
  }),
  now,
  now
);
let view: EditorView | undefined;
const events: string[] = [],
  errors: string[] = [];
let sentUpdates = 0;
const incoming: Uint8Array[] = [];
const sink: ViewSink = {
  apply(words, strings, effects) {
    // Observe the DOM while native composition ends, before merged paint.
    if (effects?.some((effect) => effect.kind === 9))
      events.push('end-before-paint:' + root.textContent);
    view?.apply(words, strings, effects);
  },
  acknowledgeText(input) {
    view?.acknowledgeText(input);
  },
  acknowledgeSelection(selection) {
    view?.acknowledgeSelection(selection);
  },
  text(key) {
    return view?.text(key) ?? null;
  },
};
function receive(message: FromRemote) {
  for (const frame of intoFrames(FromRemote.encode(message)))
    run(() => session.socketFrame(1, frame, now));
}
function run(call: () => number, after?: (flags: number) => void): void {
  const flags = call();
  if (flags & 3) {
    const output = decodeOutput(session.takeOutput());
    for (const effect of output.viewEffects)
      if (effect.kind === 2) console.error('IME session:', effect.text);
    sink.apply(output.view, output.strings, output.viewEffects);
    for (const effect of output.effects) {
      if (effect.tag === 8) {
        const record = TelemetryMsg.decode(effect.payload);
        if (record.name) events.push(record.name);
      }
      if (effect.tag !== 3) continue;
      const message = FromPeer.decode(effect.payload.subarray(1));
      if (message.isPeerUpdate()) {
        sentUpdates++;
        for (const update of message.value.updates) server.import(update);
        incoming.push(
          ...intoFrames(
            FromRemote.encode(
              FromRemote.fromRemoteUpdateAck({ id: message.value.id })
            )
          )
        );
      }
    }
  }
  after?.(flags);
  for (const frame of incoming.splice(0))
    run(() => session.socketFrame(1, frame, now));
}
const port = new SessionPort({ session, run, now: () => now }, sink, true);
view = EditorView.mount(root, port, createBuiltinRegistry(), {
  namespace: 'ime',
  theme: {},
  editable: true,
  preset: 'rich',
  onError: (error) => errors.push(String(error)),
});
run(() => session.input(SessionInputMsg.encode(emptyInput(0)), now, now));
run(() =>
  session.input(
    SessionInputMsg.encode({ ...emptyInput(1), bytes: seed }),
    now,
    now
  )
);
run(() => session.socketOpened(1, now, now));
receive(
  FromRemote.fromRemoteInitialSync({
    snapshot: new Uint8Array(),
    awareness: new Uint8Array(),
  })
);
receive(
  FromRemote.fromRemoteUpdateSince({
    vv: server.version().encode(),
    update: new Uint8Array(),
  })
);
const fixture = {
  selectEnd() {
    const node = [...view!.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!node) throw new Error('Missing text');
    const dom = view!.getElementByKey(node.key)?.firstChild;
    if (!dom) throw new Error('Missing text DOM');
    root.focus();
    document
      .getSelection()
      ?.setBaseAndExtent(dom, node.text.length, dom, node.text.length);
    port.selectionFromView({
      kind: 'range',
      anchor: { key: node.key, offset: node.text.length, type: 'text' },
      focus: { key: node.key, offset: node.text.length, type: 'text' },
    });
  },
  remote() {
    const before = server.version();
    remoteText.insert(0, '遠');
    server.commit();
    receive(
      FromRemote.fromRemoteUpdate({
        update: server.export({ mode: 'update', from: before }),
      })
    );
  },
  advance(ms: number) {
    now = ms;
    run(() => session.tick(now, now));
  },
  flush() {
    run(() =>
      session.input(
        SessionInputMsg.encode({ ...emptyInput(4), request: 1 }),
        now,
        now
      )
    );
  },
  result() {
    return {
      model: session.textContent(),
      mirror: [...view!.mirror.values()]
        .filter((node) => node.kind === 'text')
        .map((node) => node.text)
        .join(''),
      remote: remoteText.toString(),
      events,
      errors,
      sentUpdates,
    };
  },
};
Object.assign(window, { imeFixture: fixture });
