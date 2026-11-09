import type { NativeMarkdownEditingPort } from '@core/component/LexicalMarkdown/editing/nativeMarkdownPorts';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  ABI_MAJOR,
  type IViewEffectMsg,
  SessionConfigMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  type ExecutorOptions,
  type SessionAuthorization,
  SessionExecutor,
  type ViewApplier,
} from '@macro-inc/collaboration/session/executor';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import {
  type EditorView,
  mountSessionView,
  type NodeViewRegistry,
  type ViewOptions,
} from '@macro-inc/lexical-wasm-view';
import type { Span } from '@macro-inc/observability';

import { sessionSocketUrl } from './session-socket-url';

type SessionModule = typeof import('@macro-inc/collaboration/session/wasm');

interface DocumentSessionOptions {
  documentId: string;
  user: string;
  access: number;
  authorization: SessionAuthorization;
  viewEngine: number;
  viewOs: number;
  span: Span;
  onStatus(status: IViewEffectMsg): void;
}

type CreateSession = (
  config: Uint8Array,
  now: number,
  wall: number
) => EditorSession;

/** Prepare document I/O without creating DOM or starting the session. */
export function createRustSession(
  options: DocumentSessionOptions & {
    create: CreateSession;
    sink: ViewApplier;
    headless?: boolean;
  }
) {
  const configured = configureSession(
    options,
    options.create,
    options.headless ?? false
  );
  let started = false;
  let starting = false;
  const pendingAuthorization: (() => void)[] = [];
  let executor: SessionExecutor;
  try {
    executor = new SessionExecutor({
      ...configured.session,
      view: options.sink,
      auth: {
        ...configured.session.auth,
        subscribe(callback) {
          return configured.session.auth.subscribe((...access) => {
            const admit = () => callback(...access);
            if (started) admit();
            else pendingAuthorization.push(admit);
          });
        },
      },
    });
  } catch (error) {
    configured.dispose();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    executor,
    start() {
      if (started || starting || closing) return;
      starting = true;
      try {
        // Registration is complete. Preserve notification order even if
        // output admission synchronously triggers another access change.
        executor.start();
        while (pendingAuthorization.length) pendingAuthorization.shift()?.();
        started = true;
      } finally {
        starting = false;
      }
    },
    close() {
      pendingAuthorization.length = 0;
      closing ??= (async () => {
        // Publish the shared promise before terminal output can reenter close.
        await Promise.resolve();
        try {
          await executor.close();
        } finally {
          configured.dispose();
        }
      })();
      return closing;
    },
  };
}

/** App configuration over the shared SessionExecutor/SessionPort view composition. */
export function createRustEditorSession(
  options: DocumentSessionOptions & {
    module: SessionModule;
    root: HTMLElement;
    registry: NodeViewRegistry;
    view: ViewOptions;
    installEditing?: (view: EditorView) => NativeMarkdownEditingPort;
  }
) {
  const configured = configureSession(
    options,
    (config, now, wall) =>
      options.module.EditorSession.createMacro(ABI_MAJOR, config, now, wall),
    false
  );
  let mounted: ReturnType<typeof mountSessionView> | undefined;
  try {
    const runtime = mountSessionView(
      options.root,
      options.registry,
      options.view,
      configured.session
    );
    mounted = runtime;
    const editing = options.installEditing?.(runtime.view);
    let closing: Promise<void> | undefined;
    return {
      ...runtime,
      editing,
      close() {
        closing ??= (async () => {
          try {
            editing?.dispose();
          } finally {
            try {
              await runtime.close();
            } finally {
              configured.dispose();
            }
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    const closeFailed = async () => {
      try {
        await mounted?.close();
      } finally {
        configured.dispose();
      }
    };
    fireAndForget(closeFailed(), 'rust-editor.mount.close');
    throw error;
  }
}

function configureSession(
  options: DocumentSessionOptions,
  create: CreateSession,
  headless: boolean
) {
  const owner = crypto.randomUUID();
  const sessionSpan = options.span.span('doc.session');
  const telemetry = new SessionTelemetry(sessionSpan);
  const session: Omit<ExecutorOptions<EditorSession>, 'view'> = {
    doc: options.documentId,
    owner,
    user: options.user,
    create: (now, wall) =>
      create(
        SessionConfigMsg.encode({
          doc: options.documentId,
          session: owner,
          user: options.user,
          peers: [...crypto.getRandomValues(new BigUint64Array(4))].map(
            (value) => value & ((1n << 63n) - 1n)
          ),
          access: options.access,
          transport: Transport.Direct,
          durable: true,
          chatter: true,
          headless,
          viewEngine: options.viewEngine,
          viewOs: options.viewOs,
          token: '',
          traceparent: sessionSpan.traceparent() ?? '',
          coalesce: 25,
          snapshotInterval: 15000,
          observed: [],
        }),
        now,
        wall
      ),
    auth: {
      token: (doc) => sessionSpan.run(() => options.authorization.token(doc)),
      subscribe: (callback) => options.authorization.subscribe(callback),
    },
    socketUrl: sessionSocketUrl,
    telemetry,
    onStatus: options.onStatus,
  };
  return {
    session,
    dispose() {
      telemetry.close();
      sessionSpan.end();
    },
  };
}
