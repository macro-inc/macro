import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  mountSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import * as native from '../../../../document-session/wasm/document_session_wasm.js';

/** Actual browser host primitives supplied to the production local-session mount. */
export function initializeNativeKeyboardSurface() {
  const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const previousScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  );
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value() {},
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
  return () => {
    if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
    else Reflect.deleteProperty(navigator, 'locks');
    if (previousScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        previousScroll
      );
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  };
}

export function nativeKeyboardSurface(withCommands = true) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-keyboard-controls',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    },
    {
      nativeCommands: withCommands ? native : undefined,
      viewEngine: 1,
      viewOs: 0,
      create: (config, now, wall) =>
        native.EditorSession.createMacro(ABI_MAJOR, config, now, wall),
    }
  );
  const counters = { admissions: 0 };
  const run = runtime.executor.run.bind(runtime.executor);
  runtime.executor.run = (call, after) => {
    counters.admissions++;
    run(call, after);
  };
  return {
    ...runtime,
    root,
    counters,
    session: runtime.executor.session,
    async close() {
      try {
        await runtime.close();
      } finally {
        root.remove();
      }
    },
  };
}

/** Public production mount, with only its existing host hook supplied by controls. */
export function nativeAcknowledgementSurface(
  beforeConsume?: (session: native.EditorSession, flags: number) => void
) {
  const root = document.createElement('div');
  document.body.append(root);
  const owner = crypto.randomUUID();
  let actual: native.EditorSession | undefined;
  const runtime = mountSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-ack-controls',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    },
    {
      doc: `ack-${owner}`,
      owner,
      user: '',
      locks,
      create(now, wall) {
        actual = native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          SessionConfigMsg.encode({
            doc: `ack-${owner}`,
            session: owner,
            user: '',
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
          now,
          wall,
          'native-ack-controls'
        );
        return actual;
      },
      auth: {
        async token() {
          throw new Error('Local fixture cannot fetch a token');
        },
        subscribe: () => () => {},
      },
      socketUrl() {
        throw new Error('Local fixture cannot connect');
      },
      telemetry: new SessionTelemetry(NOOP_SPAN),
      beforeConsume(flags) {
        if (!actual) throw new Error('Missing actual native session');
        beforeConsume?.(actual, flags);
      },
    },
    native
  );
  runtime.executor.run(() =>
    runtime.executor.session.input(
      SessionInputMsg.encode(emptyInput(1)),
      runtime.executor.now(),
      Date.now()
    )
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'a' }] },
        ],
      },
    })
  );
  const leaf = [...runtime.view.mirror.values()].find(
    (node) => node.type === 'text'
  );
  if (!leaf) throw new Error('Missing actual native text');
  // The first view edit establishes actual view ownership and may emit a real
  // selection Diff. Settle that genuine packet before testing logical-zero echoes.
  for (const text of ['aa', 'a'])
    runtime.port.textFromView({
      key: leaf.key,
      text,
      anchorOffset: text.length,
      focusOffset: text.length,
    });

  return {
    ...runtime,
    root,
    leaf,
    session: runtime.executor.session,
    async close() {
      try {
        await runtime.close();
      } finally {
        root.remove();
      }
    },
  };
}
