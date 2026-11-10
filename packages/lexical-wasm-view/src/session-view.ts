import {
  type ExecutorOptions,
  type SessionAuthorization,
  SessionExecutor,
} from '@macro-inc/collaboration/session/executor';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { EditorView, type ViewOptions } from './view/editor-view';
import type { ViewSink } from './view/port';
import type { NodeViewRegistry } from './view/registry';
import { SessionPort } from './view/session-port';

const ownedSessions = new WeakSet<EditorSession>();

/** Connect the view to the existing I/O executor after the host loads WASM. */
export function mountSessionView(
  root: HTMLElement,
  registry: NodeViewRegistry,
  options: ViewOptions,
  session: Omit<ExecutorOptions<EditorSession>, 'view'>
) {
  let view: EditorView | undefined;
  let disposed = false;
  let closing: Promise<void> | undefined;
  let authorizationReady = false;
  const authorization: (() => void)[] = [];
  let attached: EditorSession | undefined;
  let authorizationCallback:
    | Parameters<SessionAuthorization['subscribe']>[0]
    | undefined;
  let unsubscribeAuthorization: (() => void) | undefined;
  const sink: ViewSink = {
    apply(...output) {
      if (disposed) return;
      if (!view) throw new Error('Native output before view mount');
      view.apply(...output);
    },
    acknowledgeText(input) {
      if (!view) throw new Error('Text input before view mount');
      view.acknowledgeText(input);
    },
    acknowledgeSelection(selection) {
      if (!view) throw new Error('Selection input before view mount');
      view.acknowledgeSelection(selection);
    },
    text(key) {
      return view?.text(key) ?? null;
    },
  };
  const retire = () => {
    const native = attached;
    if (!native) return;
    attached = undefined;
    native.retireViewObservation();
  };
  let executor: SessionExecutor<EditorSession> | undefined;
  try {
    const running = new SessionExecutor({
      ...session,
      create(now, wall) {
        const native = session.create(now, wall);
        if (ownedSessions.has(native))
          throw new Error('Native session already belongs to an editor view');
        ownedSessions.add(native);
        attached = native;
        return native;
      },
      auth: {
        token: (doc) => session.auth.token(doc),
        subscribe(callback) {
          authorizationCallback = callback;
          return () => {
            authorizationCallback = undefined;
            unsubscribeAuthorization?.();
          };
        },
      },
      onConstructionFailure(native) {
        try {
          retire();
        } finally {
          session.onConstructionFailure?.(native);
        }
      },
      view: sink,
    });
    executor = running;
    const port = new SessionPort(running, sink);
    view = EditorView.mount(root, port, registry, options);
    unsubscribeAuthorization = session.auth.subscribe((...facts) => {
      const deliver = () => {
        if (!disposed) authorizationCallback?.(...facts);
      };
      if (authorizationReady) deliver();
      else authorization.push(deliver);
    });
    while (authorization.length) authorization.shift()?.();
    authorizationReady = true;
    running.start();
    const mounted = view;
    return {
      view,
      port,
      executor: running,
      close() {
        if (closing) return closing;
        disposed = true;
        view = undefined;
        authorization.length = 0;
        const terminal = Promise.withResolvers<void>();
        closing = terminal.promise;
        try {
          try {
            retire();
          } finally {
            mounted.dispose();
          }
        } catch (error) {
          running.close().then(() => terminal.reject(error), terminal.reject);
          return closing;
        }
        running.close().then(terminal.resolve, terminal.reject);
        return closing;
      },
    };
  } catch (error) {
    disposed = true;
    authorization.length = 0;
    const failed = view;
    view = undefined;
    for (const cleanup of [retire, () => failed?.dispose()]) {
      try {
        cleanup();
      } catch (cleanupError) {
        try {
          Telemetry.error(cleanupError, { surface: 'editor.mount.cleanup' });
        } catch {
          // Keep the original mount failure, including non-Error thrown values.
        }
      }
    }
    // A partial executor owns its own constructor cleanup; only a completed one can close.
    executor
      ?.close()
      .catch((closeError) =>
        Telemetry.error(closeError, { surface: 'editor.mount.close' })
      );
    throw error;
  }
}
