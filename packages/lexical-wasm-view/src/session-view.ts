import {
  type ExecutorFailure,
  type ExecutorOptions,
  type SessionAuthorization,
  SessionExecutor,
} from '@macro-inc/collaboration/session/executor';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { EditorView, type ViewOptions } from './view/editor-view';
import {
  NativeEnterDispatcher,
  type NativeEnterModule,
} from './view/native-enter';
import {
  type NativeEnterBinding,
  NativeEnterOutput,
} from './view/native-enter-output';
import type { ViewSink } from './view/port';
import type { NodeViewRegistry } from './view/registry';
import { SessionPort } from './view/session-port';

const ownedSessions = new WeakSet<EditorSession>();

/** Connect the view to the existing I/O executor after the host loads WASM. */
export function mountSessionView(
  root: HTMLElement,
  registry: NodeViewRegistry,
  options: ViewOptions,
  session: Omit<ExecutorOptions<EditorSession>, 'view'>,
  nativeCommands?: NativeEnterModule
) {
  const dispatcher = nativeCommands
    ? NativeEnterDispatcher.forModule(nativeCommands)
    : undefined;
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
  let commands: NativeEnterBinding | undefined;
  let deferredAbort: ExecutorFailure | undefined;
  let applyingOutput = false;
  const finishTeardowns = (aborted?: ExecutorFailure) => {
    const previous = deferredAbort;
    deferredAbort ??= aborted;
    try {
      for (const cleanup of dispatcher?.takeTeardowns() ?? []) {
        try {
          cleanup();
        } catch (error) {
          if (!commands) throw error;
          commands.output.recordSecondary(error);
        }
      }
    } finally {
      deferredAbort = previous;
    }
  };
  const sink: ViewSink = {
    apply(words, strings, effects) {
      const filtered = commands ? commands.output.filter(effects) : effects;
      if (disposed) return;
      if (!view) throw new Error('Native output before view mount');
      applyingOutput = true;
      try {
        view.apply(words, strings, filtered);
      } catch (error) {
        if (!commands) throw error;
        commands.output.recordSecondary(error, true);
      } finally {
        applyingOutput = false;
      }
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
      beforeConsume(flags, completion) {
        commands?.output.beforeConsume(flags, completion);
        finishTeardowns();
        try {
          session.beforeConsume?.(flags, completion);
        } catch (error) {
          if (!commands) throw error;
          commands.output.recordSecondary(error, true);
        }
      },
      afterDrain(failure, drain) {
        if (!commands) {
          session.afterDrain?.(failure, drain);
          return;
        }
        let aborted = failure;
        const inherited = deferredAbort;
        finishTeardowns(failure);
        try {
          session.afterDrain?.(failure, drain);
        } catch (error) {
          if (commands) commands.output.recordSecondary(error);
          else if (!aborted) aborted = { error };
        }
        commands?.output.afterDrain(inherited ?? aborted, drain);
        if (!failure && aborted) throw aborted.error;
      },
      onStatus(status) {
        try {
          session.onStatus?.(status);
        } catch (error) {
          if (!commands) throw error;
          commands.output.recordSecondary(error, true);
        }
      },
      view: sink,
    });
    executor = running;
    if (dispatcher) {
      const owner = dispatcher.owner(running.session);
      commands = {
        dispatcher,
        owner,
        output: new NativeEnterOutput(
          running.session,
          dispatcher,
          owner,
          options.onError
        ),
      };
    }
    const port = new SessionPort(running, sink, undefined, commands);
    view = EditorView.mount(
      root,
      port,
      registry,
      commands
        ? {
            ...options,
            onError(error) {
              try {
                options.onError(error);
              } catch (failure) {
                if (!applyingOutput) throw failure;
                commands?.output.recordSecondary(failure);
              }
            },
          }
        : options
    );
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
        mounted.beginTeardown();
        commands?.output.beginTeardown();
        let requestFailure: ExecutorFailure | undefined;
        const finish = () => {
          const release = () => {
            if (commands)
              commands.dispatcher.releaseOwner(running.session, commands.owner);
          };
          let failed = requestFailure;
          const cleanup = (call: () => void) => {
            try {
              call();
            } catch (error) {
              if (!failed) failed = { error };
              else {
                try {
                  Telemetry.error(error, { surface: 'editor.close.cleanup' });
                } catch {
                  /* Preserve the first teardown failure. */
                }
              }
            }
          };
          cleanup(retire);
          cleanup(() => mounted.dispose());
          cleanup(() =>
            commands?.dispatcher.unregisterOwner(
              running.session,
              commands.owner
            )
          );
          const complete = (failure?: { error: unknown }) => {
            const primary = failed ?? failure;
            try {
              release();
            } catch (error) {
              if (!primary) {
                terminal.reject(error);
                return;
              }
              try {
                Telemetry.error(error, { surface: 'editor.close.release' });
              } catch {
                /* Preserve the earlier close failure. */
              }
            }
            if (primary) terminal.reject(primary.error);
            else terminal.resolve();
          };
          running.close().then(
            () => complete(),
            (error) => complete({ error })
          );
        };
        const active = commands?.dispatcher.activeScope();
        if (commands && active) {
          if (active.owner === commands.owner) {
            try {
              commands.dispatcher.requestRetirement(commands.owner);
              attached = undefined;
              commands.dispatcher.unregisterOwner(
                running.session,
                commands.owner
              );
            } catch (error) {
              requestFailure = { error };
            }
          }
          commands.dispatcher.deferTeardown(finish);
        } else finish();
        return closing;
      },
    };
  } catch (error) {
    disposed = true;
    authorization.length = 0;
    const failed = view;
    view = undefined;
    commands?.output.beginTeardown();
    for (const cleanup of [
      retire,
      () => failed?.dispose(),
      () => {
        if (commands && executor)
          commands.dispatcher.unregisterOwner(executor.session, commands.owner);
      },
    ]) {
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
    const running = executor;
    if (running) {
      const release = () => {
        if (commands)
          commands.dispatcher.releaseOwner(running.session, commands.owner);
      };
      running.close().then(
        () => {
          try {
            release();
          } catch (cleanupError) {
            try {
              Telemetry.error(cleanupError, {
                surface: 'editor.mount.release',
              });
            } catch {
              /* Preserve mount cause. */
            }
          }
        },
        (closeError) => {
          try {
            release();
          } catch (cleanupError) {
            try {
              Telemetry.error(cleanupError, {
                surface: 'editor.mount.release',
              });
            } catch {
              /* Preserve mount cause. */
            }
          }
          try {
            Telemetry.error(closeError, { surface: 'editor.mount.close' });
          } catch {
            /* Preserve mount cause. */
          }
        }
      );
    }
    throw error;
  }
}
