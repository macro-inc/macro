// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { beforeAll, expect, test } from 'vitest';
import { registerNativeNormalizeEnter } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/native';
import { registerNativeTabIndentation } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/tab-indentation/native';
import {
  EditorSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { EditorView } from './editor-view';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';
import type { ViewSink } from './port';
import { SessionPort } from './session-port';

beforeAll(() =>
  initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  })
);

test('application Tab routes once through the real Macro session despite its critical table listener', () => {
  const session = EditorSession.createMacro(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'group-b-key-fixture',
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
  let calls = 0;
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
      calls++;
      const flags = call();
      if (flags & (1 | 2 | 8 | 16)) {
        const output = decodeOutput(session.takeOutput());
        sink.apply(output.view, output.strings, output.viewEffects);
      }
      after?.(flags);
    },
  };
  const port = new SessionPort(executor, sink, false);
  const root = document.createElement('div');
  document.body.appendChild(root);
  view = EditorView.mount(
    root,
    port,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'group-b-keys',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    }
  );
  const mounted = view;
  const releaseTab = registerNativeTabIndentation(mounted);
  const releaseEnter = registerNativeNormalizeEnter(mounted);
  try {
    expect(port.listeners().get('Key(Tab)')).toBe(
      (1 << 4) | (1 << 2) | (1 << 0)
    );
    executor.run(() =>
      session.input(SessionInputMsg.encode(emptyInput(0)), 1, 1)
    );
    executor.run(() =>
      session.input(SessionInputMsg.encode(emptyInput(1)), 2, 2)
    );
    port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: [
                    {
                      type: 'tablecell',
                      version: 1,
                      headerState: 0,
                      colSpan: 1,
                      rowSpan: 1,
                      children: [
                        { type: 'paragraph', version: 1, children: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    );
    const paragraph = [...mounted.mirror.values()].find(
      (node) =>
        node.type === 'paragraph' &&
        mounted.node(node.parent ?? 0)?.type === 'tablecell'
    );
    if (!paragraph) throw new Error('Missing table paragraph');
    root.focus();
    const element = mounted.getElementByKey(paragraph.key);
    if (!element) throw new Error('Missing paragraph element');
    document.getSelection()?.setBaseAndExtent(element, 0, element, 0);
    port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, offset: 0, type: 'element' },
      focus: { key: paragraph.key, offset: 0, type: 'element' },
    });
    const originalQuery = session.query.bind(session);
    let queries = 0;
    session.query = (input) => {
      queries++;
      return originalQuery(input);
    };
    session.nodeText = () => {
      throw new Error('Per-node crossing on routed key');
    };
    calls = 0;
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(calls).toBe(1);
    expect(root.querySelectorAll('tr')).toHaveLength(2);
    expect(queries).toBe(0);
    calls = 0;
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        keyCode: 88,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(calls).toBe(0);
  } finally {
    releaseTab();
    releaseEnter();
    mounted.dispose();
    root.remove();
    session.free();
  }
});
