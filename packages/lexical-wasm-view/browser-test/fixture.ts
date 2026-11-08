import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { NOOP_SPAN } from '@macro-inc/observability';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { SessionExecutor } from '@macro-inc/collaboration/session/executor';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { selectionMessage } from '../src/view/session-port';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { EditorView } from '../src/view/editor-view';
import { SessionPort } from '../src/view/session-port';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import type { ViewSink } from '../src/view/port';
import {
  fixtureTypes,
  registerFixtureViews,
  renderFixture,
} from './render-fixture';
import type { TypeRow } from '../src/view/types';

await init();
const root = document.getElementById('editor');
if (!root) throw new Error('Missing editor root');
let view: EditorView | undefined;
const errors: string[] = [];
const sink: ViewSink = {
  apply(words, strings, effects) {
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
const executor = new SessionExecutor({
  doc: 'browser-view-fixture',
  owner: '00000000-0000-0000-0000-000000000001',
  user: 'fixture-user',
  view: sink,
  auth: {
    async token() {
      return { token: '', access: 2 };
    },
    subscribe() {
      return () => {};
    },
  },
  socketUrl: () => {
    throw new Error('Offline fixture must not connect');
  },
  telemetry: new SessionTelemetry(NOOP_SPAN),
  create: (now, wall) =>
    EditorSession.create(
      ABI_MAJOR,
      SessionConfigMsg.encode({
        doc: 'browser-view-fixture',
        session: '00000000-0000-0000-0000-000000000001',
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
        coalesce: 10000,
        snapshotInterval: 0,
        observed: [],
      }),
      now,
      wall
    ),
});
class FixturePort extends SessionPort {
  override types(): readonly TypeRow[] {
    return [...super.types(), ...fixtureTypes];
  }
}
const port = new FixturePort(executor, sink, false);
view = EditorView.mount(
  root,
  port,
  registerFixtureViews(createBuiltinRegistry()),
  {
    namespace: 'fixture',
    theme: {},
    editable: true,
    preset: 'rich',
    onError: (error) => errors.push(String(error)),
  }
);
executor.start();
executor.run(() =>
  executor.session.input(
    SessionInputMsg.encode(emptyInput(1)),
    executor.now(),
    Date.now()
  )
);
const fixture = {
  render: renderFixture(view),
  presence(visible: boolean) {
    const template = decodeOutput(executor.session.initialize()).viewEffects[0];
    const node = [...view!.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!template || !node) throw new Error('Missing presence fixture state');
    const marker = { ...template, kind: 10, flag: true };
    const effects = [marker];
    if (visible)
      effects.push({
        ...marker,
        flag: false,
        keys: ['fixture-peer', 'blue'],
        selection: selectionMessage({
          kind: 'range',
          anchor: { key: node.key, offset: 0, type: 'text' },
          focus: { key: node.key, offset: node.text.length, type: 'text' },
        }),
      });
    view!.apply(new Uint32Array(), new Uint8Array(), effects);
  },
  reset(text: string) {
    port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text,
                  format: 0,
                  detail: 0,
                  mode: 'normal',
                  style: '',
                },
              ],
            },
          ],
        },
      })
    );
  },
  setState(json: string) {
    port.setState(json);
  },
  selectEnd() {
    const text = [...view!.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!text) throw new Error('Missing fixture text');
    root.focus();
    const dom = view!.getElementByKey(text.key)?.firstChild;
    if (!dom) throw new Error('Missing text DOM');
    document
      .getSelection()
      ?.setBaseAndExtent(dom, text.text.length, dom, text.text.length);
    port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset: text.text.length, type: 'text' },
      focus: { key: text.key, offset: text.text.length, type: 'text' },
    });
  },
  text: () => executor.session.textContent(),
  mirrorText: () =>
    [...view!.mirror.values()]
      .filter((node) => node.kind === 'text')
      .map((node) => node.text)
      .join(''),
  undo: () => port.command(CommandCode.Undo),
  redo: () => port.command(CommandCode.Redo),
  errors,
  crossings: new Array<string>(),
  metrics: { calls: 0, nodeCalls: 0, selectionWrites: 0, textWrites: 0 },
  count() {
    fixture.metrics.calls =
      fixture.metrics.nodeCalls =
      fixture.metrics.selectionWrites =
      fixture.metrics.textWrites =
        0;
    function counted<A extends unknown[], R>(
      name: string,
      call: (...args: A) => R
    ): (...args: A) => R {
      return (...args) => {
        fixture.metrics.calls++;
        fixture.crossings.push(name);
        return call(...args);
      };
    }
    const session = executor.session;
    session.textFromView = counted(
      'textFromView',
      session.textFromView.bind(session)
    );
    session.keyDown = counted('keyDown', session.keyDown.bind(session));
    session.selectionFromView = counted(
      'selectionFromView',
      session.selectionFromView.bind(session)
    );
    session.command = counted('command', session.command.bind(session));
    session.input = counted('input', session.input.bind(session));
    session.takeOutput = counted(
      'takeOutput',
      session.takeOutput.bind(session)
    );
    session.wakeAt = counted('wakeAt', session.wakeAt.bind(session));
    session.query = counted('query', session.query.bind(session));
    session.clipboard = counted('clipboard', session.clipboard.bind(session));
    session.composition = counted(
      'composition',
      session.composition.bind(session)
    );
    session.initialize = counted(
      'initialize',
      session.initialize.bind(session)
    );
    session.textContent = counted(
      'textContent',
      session.textContent.bind(session)
    );
    session.nodeText = () => {
      fixture.metrics.nodeCalls++;
      throw new Error('Per-node production crossing');
    };
    const selection = document.getSelection();
    if (selection) {
      const original = selection.setBaseAndExtent.bind(selection);
      selection.setBaseAndExtent = (...args) => {
        fixture.metrics.selectionWrites++;
        original(...args);
      };
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Node.prototype,
      'nodeValue'
    );
    if (descriptor?.set && descriptor.get) {
      const setter = descriptor.set;
      Object.defineProperty(Node.prototype, 'nodeValue', {
        ...descriptor,
        set(value) {
          fixture.metrics.textWrites++;
          setter.call(this, value);
        },
      });
    }
  },
};
Object.assign(window, { fixture });
fixture.reset('a');
port.command(CommandCode.ClearHistory);
