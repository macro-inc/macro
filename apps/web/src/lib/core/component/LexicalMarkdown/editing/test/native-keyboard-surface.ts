import type {
  ExecutorDrain,
  ExecutorFailure,
} from '@macro-inc/collaboration/session/executor';
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
import {
  type NativeCodeTokenProvider,
  NativeEnterDispatcher,
} from '@macro-inc/lexical-wasm-view/view/native-enter';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import * as native from '../../../../document-session/wasm/document_session_wasm.js';

export interface NativeKeyboardCleanupFailure {
  readonly error: unknown;
}

function reportCleanup(error: unknown): void {
  try {
    Telemetry.error(error, { surface: 'native.keyboard.fixture.cleanup' });
  } catch {
    // Raw cleanup causes stay in the caller-owned collection. Never replace
    // the original setup failure with a secondary reporter failure.
  }
}

/** Actual browser host primitives supplied to the production local-session mount. */
export function initializeNativeKeyboardSurface(
  secondary: NativeKeyboardCleanupFailure[] = []
) {
  const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const previousScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  );
  // Own BOTH restoration actions before the first descriptor mutation. The
  // native initializer may fail after either mutation has succeeded.
  let restored = false;
  const unwind = () => {
    if (restored) return [];
    restored = true;
    const failures: NativeKeyboardCleanupFailure[] = [];
    for (const restore of [
      () => {
        if (previousLocks)
          Object.defineProperty(navigator, 'locks', previousLocks);
        else if (!Reflect.deleteProperty(navigator, 'locks'))
          throw new Error('Unable to restore fixture locks');
      },
      () => {
        if (previousScroll)
          Object.defineProperty(
            HTMLElement.prototype,
            'scrollIntoView',
            previousScroll
          );
        else if (
          !Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
        )
          throw new Error('Unable to restore fixture scrolling');
      },
    ]) {
      try {
        restore();
      } catch (error) {
        failures.push({ error });
      }
    }
    secondary.push(...failures);
    for (const failure of failures) reportCleanup(failure.error);
    return failures;
  };
  try {
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
  } catch (error) {
    unwind();
    throw error;
  }
  return () => {
    const failures = unwind();
    if (failures.length) throw failures[0].error;
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
export async function nativeAcknowledgementSurface(
  beforeConsume?: (session: native.EditorSession, flags: number) => void,
  afterDrain?: (failure?: ExecutorFailure, drain?: ExecutorDrain) => void,
  secondary: NativeKeyboardCleanupFailure[] = [],
  options?: {
    codeTokens?: { provider: NativeCodeTokenProvider; profile: string };
    primeEcho?: boolean;
  }
) {
  let root: HTMLDivElement | undefined;
  let runtime: ReturnType<typeof mountSessionView> | undefined;
  let closing: Promise<NativeKeyboardCleanupFailure[]> | undefined;
  // The cleanup owner exists before root append and before runtime acquisition.
  const release = () => {
    if (closing) return closing;
    const owned = runtime;
    runtime = undefined;
    // Publish the terminal promise before invoking any cleanup callback, so a
    // reentrant close joins this owner instead of acquiring a second cleanup.
    closing = Promise.resolve().then(async () => {
      const failures: NativeKeyboardCleanupFailure[] = [];
      const close = async () => {
        try {
          await owned?.close();
        } catch (error) {
          failures.push({ error });
        }
      };
      const pending = close();
      // Root cleanup is independent of a throwing or still-pending close.
      try {
        root?.remove();
      } catch (error) {
        failures.push({ error });
      }
      await pending;
      secondary.push(...failures);
      for (const failure of failures) reportCleanup(failure.error);
      return failures;
    });
    return closing;
  };
  try {
    const provider = options?.codeTokens
      ? NativeEnterDispatcher.forModule(native).fenceCodeTokenProvider(
          options.codeTokens.provider
        )
      : undefined;
    root = document.createElement('div');
    document.body.append(root);
    const owner = crypto.randomUUID();
    let actual: native.EditorSession | undefined;
    runtime = mountSessionView(
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
            'native-ack-controls',
            undefined,
            undefined,
            provider,
            options?.codeTokens?.profile
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
        afterDrain,
        beforeConsume(flags) {
          if (!actual) throw new Error('Missing actual native session');
          beforeConsume?.(actual, flags);
        },
      },
      native
    );
    const mounted = runtime;
    mounted.executor.run(() =>
      mounted.executor.session.input(
        SessionInputMsg.encode(emptyInput(1)),
        mounted.executor.now(),
        Date.now()
      )
    );
    mounted.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'a' }] },
          ],
        },
      })
    );
    const leaf = [...mounted.view.mirror.values()].find(
      (node) => node.type === 'text'
    );
    if (!leaf) throw new Error('Missing actual native text');
    // The first view edit establishes actual view ownership and may emit a real
    // selection Diff. Settle that genuine packet before testing logical-zero echoes.
    if (options?.primeEcho !== false) {
      for (const text of ['aa', 'a'])
        mounted.port.textFromView({
          key: leaf.key,
          text,
          anchorOffset: text.length,
          focusOffset: text.length,
        });
    }

    return {
      ...mounted,
      root,
      leaf,
      session: mounted.executor.session,
      cleanupFailures: secondary,
      async close() {
        const failures = await release();
        if (failures.length) throw failures[0].error;
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
