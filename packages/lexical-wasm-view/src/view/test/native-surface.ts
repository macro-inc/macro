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
import {
  EditorSession,
  initSync,
} from '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { EditorView } from '../editor-view';
import { createBuiltinRegistry } from '../node-views/builtins';
import { registerMacroElementViews } from '../node-views/macro';
import type { ViewSink } from '../port';
import { SessionPort } from '../session-port';

/** Load the same production artifact used by session and browser integration tests. */
export function initializeNativeSurfaceTests() {
  initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
}
/** A real Macro session with synchronous execution and a mounted Diff-driven view. */
export function nativeSurface() {
  const session = EditorSession.createMacro(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'group-b-view-fixture',
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
  const counters = { admissions: 0 };
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
      counters.admissions++;
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
      namespace: 'group-b-view',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    }
  );
  const mounted = view;
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(0)), 1, 1)
  );
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(1)), 2, 2)
  );
  return {
    session,
    view: mounted,
    port,
    root,
    counters,
    close() {
      mounted.dispose();
      root.remove();
      session.free();
    },
  };
}

/** Clipboard facts are tested over a real session; only the browser transfer is synthetic. */
export function transfer(
  text: string,
  html = '',
  files: File[] = []
): DataTransfer {
  const data = new Map([
    ['text/plain', text],
    ['text/html', html],
  ]);
  const fileItems: DataTransferItem[] = files.map((file) => ({
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
    getAsFileSystemHandle: async () => null,
    getAsString() {},
    webkitGetAsEntry: () => null,
  }));
  return {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: Object.assign(files, {
      item: (index: number) => files.at(index) ?? null,
    }),
    items: Object.assign(fileItems, {
      add: (_data: string | File, _type?: string) => null,
      clear() {},
      remove(_index: number) {},
    }),
    types: [...data.keys()].filter((key) => data.get(key)),
    getData: (mime) => data.get(mime) ?? '',
    setData: (mime, value) => {
      data.set(mime, value);
    },
    clearData: (mime) => {
      if (mime) data.delete(mime);
      else data.clear();
    },
    setDragImage() {},
  };
}
