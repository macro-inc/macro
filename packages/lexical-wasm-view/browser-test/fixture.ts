import {
  ABI_MAJOR,
  Access,
  CommandCode,
  type EditorInputMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  type ExecutorOptions,
  SessionExecutor,
} from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { NOOP_SPAN } from '@macro-inc/observability';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountSessionView } from '../src/session-view';
import { KEY_DOWN_COMMAND } from '../src/view/commands';
import {
  DRAG_END_COMMAND,
  DRAG_OVER_COMMAND,
  DRAG_START_COMMAND,
  INTERNAL_DROP_COMMAND,
} from '../src/view/drag';
import { EditorView } from '../src/view/editor-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import type { ViewSink } from '../src/view/port';
import { SessionPort, selectionMessage } from '../src/view/session-port';
import type { TypeRow } from '../src/view/types';
import {
  fixtureTypes,
  registerFixtureViews,
  renderFixture,
} from './render-fixture';

await init();
const root = document.getElementById('editor');
if (!root) throw new Error('Missing editor root');
let view: EditorView | undefined;
const errors: string[] = [];
const crossings: string[] = [];
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
const nativeConfig = {
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
  viewOs: /Android/.test(navigator.userAgent) ? 3 : 0,
  token: '',
  traceparent: '',
  coalesce: 10000,
  snapshotInterval: 0,
  observed: [],
};
const sessionOptions: ExecutorOptions<EditorSession> = {
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
      SessionConfigMsg.encode(nativeConfig),
      now,
      wall
    ),
};
const executor = new SessionExecutor(sessionOptions);
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
    theme: {
      text: { bold: 'theme-bold', underline: 'theme-underline' },
      heading: { h2: 'theme-h2' },
      codeHighlight: { keyword: 'theme-keyword' },
    },
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
let second: Awaited<ReturnType<typeof mountSessionView>> | undefined;
let highlightDisposers: (() => void)[] = [];
const capturedMimes: { mime: string; value: string }[] = [];
const admit = port.input.bind(port);
port.input = (input, after) => {
  if (input.isEditorPaste())
    capturedMimes.splice(0, capturedMimes.length, ...input.value.clipboard);
  admit(input, after);
};
const fixture = {
  unhandledKeyFallback() {
    class UnhandledPort extends SessionPort {
      listeners(): ReadonlyMap<string, number> {
        return new Map([['KeyDown', 16]]);
      }
      input(_input: EditorInputMsg, after?: (handled: boolean) => void): void {
        after?.(false);
      }
    }
    const element = document.createElement('div');
    document.body.appendChild(element);
    const fallback = EditorView.mount(
      element,
      new UnhandledPort(executor, sink, false),
      createBuiltinRegistry(),
      {
        namespace: 'unhandled',
        theme: {},
        editable: true,
        preset: 'rich',
        onError: (error) => errors.push(String(error)),
      }
    );
    let calls = 0;
    fallback.registerViewCommand(
      KEY_DOWN_COMMAND,
      () => {
        calls++;
        return true;
      },
      1
    );
    element.focus();
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    fallback.dispose();
    element.remove();
    return calls;
  },
  capturedMimes,
  drag() {
    const events: string[] = [];
    let keys: readonly number[] = [];
    const detach = [
      view!.registerViewCommand(
        DRAG_START_COMMAND,
        () => {
          events.push('start');
          return false;
        },
        4
      ),
      view!.registerViewCommand(
        DRAG_OVER_COMMAND,
        () => {
          events.push('over');
          return false;
        },
        4
      ),
      view!.registerViewCommand(
        DRAG_END_COMMAND,
        () => {
          events.push('end');
          return false;
        },
        4
      ),
      view!.registerViewCommand(
        INTERNAL_DROP_COMMAND,
        (request) => {
          if (request.source !== view) throw new Error('Wrong drag owner');
          keys = request.keys;
          events.push('internal');
          return true;
        },
        4
      ),
    ];
    const paragraph = root.querySelector('p'),
      text = paragraph?.querySelector('[data-lexical-text]');
    if (!paragraph || !text) throw new Error('Missing drag fixture');
    const handle = document.createElement('span');
    handle.dataset.lexicalBlockHandle = 'true';
    paragraph.append(handle);
    const data = new DataTransfer();
    handle.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      })
    );
    const rect = text.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    root.dispatchEvent(new DragEvent('dragover', init));
    root.dispatchEvent(new DragEvent('drop', init));
    root.dispatchEvent(new DragEvent('dragend', init));
    for (const remove of detach) remove();
    return {
      events,
      keys,
      payload: data.getData('application/x-lexical-drag'),
      caret: document.querySelector('[data-lexical-drop-caret]') !== null,
    };
  },
  async second(nested: boolean, state?: string) {
    const element = document.createElement('div');
    element.dataset.secondEditor = 'true';
    if (nested) {
      fixture.render.createImage();
      const widget = root.querySelector('[data-widget-instance]');
      if (!widget) throw new Error('Missing nested host');
      widget.append(element);
    } else document.body.append(element);
    second = await mountSessionView(
      element,
      createBuiltinRegistry(),
      {
        namespace: 'fixture',
        theme: {},
        editable: true,
        preset: 'rich',
        onError: (error) => errors.push(String(error)),
      },
      {
        ...sessionOptions,
        doc: 'second-view-fixture',
        owner: '00000000-0000-0000-0000-000000000002',
        telemetry: new SessionTelemetry(NOOP_SPAN),
        create: (now, wall) =>
          EditorSession.create(
            ABI_MAJOR,
            SessionConfigMsg.encode({
              ...nativeConfig,
              doc: 'second-view-fixture',
              session: '00000000-0000-0000-0000-000000000002',
              peers: [70n, 71n, 72n],
            }),
            now,
            wall
          ),
      }
    );
    second.executor.run(() =>
      second!.executor.session.input(
        SessionInputMsg.encode(emptyInput(1)),
        second!.executor.now(),
        Date.now()
      )
    );
    second.port.setState(
      state ??
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'n' }],
              },
            ],
          },
        })
    );
    const node = [...second.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!node) throw new Error('Missing second text');
    const dom = second.view.getElementByKey(node.key)?.firstChild;
    if (!dom) throw new Error('Missing second text DOM');
    element.focus();
    document.getSelection()?.setBaseAndExtent(dom, 1, dom, 1);
    second.port.selectionFromView({
      kind: 'range',
      anchor: { key: node.key, offset: 1, type: 'text' },
      focus: { key: node.key, offset: 1, type: 'text' },
    });
  },
  async highlights() {
    const { installCodeHighlighting } = await import(
      '../src/view/code-highlight'
    );
    if (!second) throw new Error('Second view not mounted');
    highlightDisposers = [
      installCodeHighlighting(view!),
      installCodeHighlighting(second.view),
    ];
  },
  disposeFirstHighlight() {
    highlightDisposers[0]?.();
  },
  async closeSecond() {
    for (const dispose of highlightDisposers) dispose();
    await second?.close();
    document.querySelector('[data-second-editor]')?.remove();
  },
  async pasteCustom() {
    const data = new DataTransfer();
    data.setData('application/x-view-fixture', 'custom-payload');
    data.setData('text/plain', 'x');
    return view!.clipboard.paste(data);
  },
  render: renderFixture(view),
  async pasteHTML(html: string) {
    const data = new DataTransfer();
    data.setData('text/html', html);
    return view!.clipboard.paste(data);
  },
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
  crossings,
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
