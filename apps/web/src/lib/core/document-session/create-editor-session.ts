import { startEditorOperation } from '@app/observability/editor';
import type { NativeMarkdownEditingPort } from '@core/component/LexicalMarkdown/editing/nativeMarkdownPorts';
import type { NativeMarkdownOverlayInstallation } from '@core/component/LexicalMarkdown/editing/nativeOverlayPorts';
import { ENABLE_MARKDOWN_SEARCH_TEXT } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  ABI_MAJOR,
  type IViewEffectMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  type ExecutorOptions,
  type SessionAuthorization,
  SessionExecutor,
  type ViewApplier,
} from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import {
  type EditorView,
  type LatestPublishedObserver,
  mountSessionView,
  type NodeViewRegistry,
  type ViewOptions,
} from '@macro-inc/lexical-wasm-view';
import {
  type NativeCodeTokenProvider,
  NativeEnterDispatcher,
} from '@macro-inc/lexical-wasm-view/view/native-enter';
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
    loadCachedSnapshot?: () => Promise<Uint8Array | undefined>;
    installEditing?: (view: EditorView) => NativeMarkdownEditingPort;
    installOverlays?: (view: EditorView) => NativeMarkdownOverlayInstallation;
    /** Construction-time observers of the latest published presentation. */
    latestPublished?: readonly LatestPublishedObserver[];
    /** Dormant host code tokenizer; fenced by the module dispatcher before construction. */
    codeTokens?: {
      provider: NativeCodeTokenProvider;
      profile: string;
    };
  }
) {
  const loadCachedSnapshot = options.loadCachedSnapshot;
  // Capture the pair once so fencing and construction see the same provider and profile.
  const codeTokens = options.codeTokens;
  const tokenProfile = codeTokens?.profile;
  const tokenProvider = codeTokens
    ? NativeEnterDispatcher.forModule(options.module).fenceCodeTokenProvider(
        codeTokens.provider
      )
    : undefined;
  const configured = configureSession(
    options,
    (config, now, wall) =>
      options.module.EditorSession.createMacroWithNamespace(
        ABI_MAJOR,
        config,
        now,
        wall,
        options.view.namespace,
        undefined,
        ENABLE_MARKDOWN_SEARCH_TEXT,
        tokenProvider,
        tokenProfile
      ),
    false
  );
  let mounted: ReturnType<typeof mountSessionView> | undefined;
  let overlays: NativeMarkdownOverlayInstallation | undefined;
  try {
    const runtime = mountSessionView(
      options.root,
      options.registry,
      {
        ...options.view,
        startPerformance:
          options.view.startPerformance ??
          ((name) => startEditorOperation(name, options.documentId)),
      },
      configured.session,
      options.module,
      options.latestPublished
    );
    mounted = runtime;
    overlays = options.installOverlays?.(runtime.view);
    const editing = options.installEditing?.(runtime.view);
    let closing: Promise<void> | undefined;
    if (loadCachedSnapshot) {
      const span = options.span.span('doc.snapshot.ingest');
      span.setAttr('document.id', options.documentId);
      span.setAttr('snapshot.source', 's3');
      fireAndForget(
        (async () => {
          try {
            const snapshot = await span.run(loadCachedSnapshot);
            if (closing || !runtime.view.isMounted) {
              span.setAttr('snapshot.outcome', 'cancelled');
              return;
            }
            if (!snapshot?.byteLength) {
              span.setAttr('snapshot.outcome', 'unavailable');
              return;
            }
            span.setAttr('snapshot.bytes', snapshot.byteLength);
            const input = SessionInputMsg.encode({
              ...emptyInput(1),
              code: 1,
              bytes: snapshot,
            });
            await new Promise<void>((resolve, reject) => {
              runtime.executor.runSettled(
                () =>
                  runtime.executor.session.input(
                    input,
                    runtime.executor.now(),
                    Date.now()
                  ),
                (result) => {
                  if (result.status === 'error') {
                    reject(result.error);
                    return;
                  }
                  span.setAttr(
                    'snapshot.outcome',
                    result.status === 'success' ? 'submitted' : 'cancelled'
                  );
                  resolve();
                }
              );
            });
          } catch (error) {
            span.setAttr('snapshot.outcome', 'error');
            throw error;
          } finally {
            span.end();
          }
        })(),
        'rust-editor.cached-snapshot'
      );
    }
    return {
      ...runtime,
      editing,
      overlays,
      /** Code-highlighting activation (C): the session carries a host code tokenizer. */
      codeHighlighting: codeTokens !== undefined,
      close() {
        closing ??= (async () => {
          // Publish the in-flight close before disposal can synchronously reenter.
          await Promise.resolve();
          try {
            overlays?.dispose();
          } finally {
            try {
              editing?.dispose();
            } finally {
              try {
                await runtime.close();
              } finally {
                configured.dispose();
              }
            }
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    const closeFailed = async () => {
      try {
        overlays?.dispose();
      } finally {
        try {
          await mounted?.close();
        } finally {
          configured.dispose();
        }
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
