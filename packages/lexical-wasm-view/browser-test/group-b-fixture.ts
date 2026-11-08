import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { registerNativeDragInsert } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/drag-insert/native';
import { registerNativeDraggableBlock } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/draggable-block/native';
import { registerNativeListSwipeIndent } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/list-swipe-indent/native';
import { registerNativeNormalizeEnter } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/native';
import { registerNativeTabIndentation } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/tab-indentation/native';
import { registerNativeTrailingParagraph } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/trailing-paragraph/native';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { EditorView } from '../src/view/editor-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '../src/view/node-views/macro';
import type { ViewSink } from '../src/view/port';
import { SessionPort } from '../src/view/session-port';

await init();
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) =>
  errors.push(String(event.reason))
);
function mount(id: string) {
  const root = document.getElementById(id);
  if (!root) throw new Error('Missing editor');
  const session = EditorSession.createMacro(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: id,
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
      coalesce: 25,
      snapshotInterval: 0,
      observed: [],
    }),
    0,
    0
  );
  let view: EditorView | undefined;
  let admissions = 0;
  let queries = 0;
  let nodeQueries = 0;
  const query = session.query.bind(session);
  const nodeText = session.nodeText.bind(session);
  const clipboard = session.clipboard.bind(session);
  session.clipboard = (kind) => {
    queries++;
    return clipboard(kind);
  };
  session.query = (input) => {
    queries++;
    return query(input);
  };
  session.nodeText = (key) => {
    nodeQueries++;
    return nodeText(key);
  };
  const sink: ViewSink = {
    apply: (words, strings, effects) => view?.apply(words, strings, effects),
    acknowledgeText: (input) => view?.acknowledgeText(input),
    acknowledgeSelection: (selection) => view?.acknowledgeSelection(selection),
    text: (key) => view?.text(key) ?? null,
  };
  const executor = {
    session,
    now: () => 1,
    run(call: () => number, after?: (flags: number) => void) {
      admissions++;
      const flags = call();
      if (flags & (1 | 2 | 8 | 16)) {
        const output = decodeOutput(session.takeOutput());
        sink.apply(output.view, output.strings, output.viewEffects);
      }
      after?.(flags);
    },
  };
  const port = new SessionPort(executor, sink, false);
  const registry = registerMacroElementViews(createBuiltinRegistry());
  registerMacroDecoratorViews(registry, {
    paste: () => {
      const host = document.createElement('div');
      host.dataset.nestedHost = id;
      return host;
    },
  });
  view = EditorView.mount(root, port, registry, {
    namespace: id,
    theme: {},
    preset: 'rich',
    editable: true,
    onError(error) {
      errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    },
  });
  const mounted = view;
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(0)), 1, 1)
  );
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(1)), 2, 2)
  );
  const handle = document.createElement('button');
  handle.className = 'draggable-block-menu';
  handle.textContent = '⋮';
  handle.draggable = true;
  handle.setAttribute('aria-label', `Move block ${id}`);
  handle.hidden = true;
  document.body.append(handle);
  const indicator = document.createElement('div');
  indicator.dataset.insertion = id;
  indicator.hidden = true;
  document.body.append(indicator);
  let hovered: HTMLElement | null = null;
  const attachInsert = () =>
    registerNativeDragInsert(mounted, (point) => {
      indicator.hidden = !point;
      if (point) {
        indicator.style.left = `${point.domRect.left}px`;
        indicator.style.width = `${point.domRect.width}px`;
        indicator.style.top = `${point.position === 'before' ? point.domRect.top : point.domRect.bottom}px`;
      }
    });
  const insertFirst = new URLSearchParams(location.search).has('insertFirst');
  let releaseInsert = () => {};
  if (insertFirst) releaseInsert = attachInsert();
  const drag = registerNativeDraggableBlock(mounted, (state) => {
    hovered = state.hoveredElement;
    handle.hidden = !hovered;
    if (hovered) {
      const rect = hovered.getBoundingClientRect();
      handle.style.left = `${rect.left - 25}px`;
      handle.style.top = `${rect.top}px`;
    }
    indicator.hidden = !state.targetElement;
    if (state.targetElement) {
      const rect = state.targetElement.getBoundingClientRect();
      indicator.style.left = `${rect.left}px`;
      indicator.style.width = `${rect.width}px`;
      indicator.style.top = `${state.targetPosition === 'before' ? rect.top : rect.bottom}px`;
    }
  });
  handle.addEventListener('dragstart', (event) => {
    if (!hovered || !drag.start(event, hovered)) {
      errors.push('Drag start rejected');
      event.preventDefault();
    }
  });
  if (!insertFirst) releaseInsert = attachInsert();
  const releaseSwipe = registerNativeListSwipeIndent(
    mounted,
    () => root.contentEditable === 'true'
  );
  const releaseGap = registerNativeTrailingParagraph(mounted);
  const releaseEnter = registerNativeNormalizeEnter(mounted);
  const releaseTab = registerNativeTabIndentation(mounted);
  return {
    set(json: string) {
      port.setState(json);
    },
    json() {
      return port.query({ kind: 7, key: 0, flags: 0, text: '' }).text;
    },
    editable(value: boolean) {
      mounted.setEditable(value);
    },
    counters() {
      return { admissions, queries, nodeQueries };
    },
    resetCounters() {
      admissions = 0;
      queries = 0;
      nodeQueries = 0;
    },
    nodes() {
      return [...mounted.mirror.values()].map((node) => ({
        key: node.key,
        type: node.type,
        text: node.text,
        parent: node.parent,
        children: node.children,
        props: node.props(),
      }));
    },
    close() {
      releaseTab();
      releaseEnter();
      releaseGap();
      releaseSwipe();
      releaseInsert();
      drag.dispose();
      mounted.dispose();
      handle.remove();
      indicator.remove();
      session.free();
    },
  };
}
const first = mount('first');
const second = mount('second');
const fixture = {
  first,
  second,
  errors,
  nest() {
    first.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paste',
              version: 1,
              content: 'nested host',
              origin: 'pasted',
            },
          ],
        },
      })
    );
    const host = document.querySelector('[data-nested-host="first"]');
    const child = document.getElementById('second');
    if (!host || !child) throw new Error('Missing nested editor host');
    host.append(child);
  },
};
declare global {
  interface Window {
    groupB: typeof fixture;
  }
}
window.groupB = fixture;
