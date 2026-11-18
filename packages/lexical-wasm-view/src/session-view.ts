import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
import {
  type ExecutorDrain,
  type ExecutorFailure,
  type ExecutorOptions,
  type SessionAuthorization,
  SessionExecutor,
} from '@macro-inc/collaboration/session/executor';
import { Flag } from '@macro-inc/collaboration/session/output';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { EditorView, type ViewOptions } from './view/editor-view';
import {
  type LatestPublishedObserver,
  LatestPublishedObservers,
  type LatestPublishedUnavailable,
} from './view/latest-published';
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
  nativeCommands?: NativeEnterModule,
  latestPublished?: readonly LatestPublishedObserver[]
) {
  const dispatcher = nativeCommands
    ? NativeEnterDispatcher.forModule(nativeCommands)
    : undefined;
  let view: EditorView | undefined;
  let disposed = false;
  let retireBeforeOutput = false;
  let closing: Promise<void> | undefined;
  let authorizationReady = false;
  const authorization: (() => void)[] = [];
  let attached: EditorSession | undefined;
  let authorizationCallback:
    | Parameters<SessionAuthorization['subscribe']>[0]
    | undefined;
  let unsubscribeAuthorization: (() => void) | undefined;
  let commands: NativeEnterBinding | undefined;
  let commandOwner:
    | Pick<NativeEnterBinding, 'dispatcher' | 'owner'>
    | undefined;
  let deferredAbort: ExecutorFailure | undefined;
  let applyingOutput = false;
  const publications = latestPublished?.length
    ? new LatestPublishedObservers(latestPublished, () =>
        !disposed && attached ? view : undefined
      )
    : undefined;
  let publicationFailure: LatestPublishedUnavailable | undefined;
  let publicationDrainDepth = 0;
  const rememberPublicationFailure = (reason: LatestPublishedUnavailable) => {
    if (!publications) return;
    if (!publicationFailure || publicationFailure.kind === 'native-error')
      publicationFailure = reason;
  };
  const finishTeardowns = (
    aborted?: ExecutorFailure,
    drain?: ExecutorDrain
  ) => {
    const previous = deferredAbort;
    deferredAbort ??= aborted;
    try {
      for (const cleanup of dispatcher?.takeTeardowns() ?? []) {
        try {
          cleanup();
        } catch (error) {
          if (!commands) throw error;
          if (drain) commands.output.recordDrainSecondary(error, drain);
          else commands.output.recordSecondary(error, true);
        }
      }
    } finally {
      deferredAbort = previous;
    }
  };
  const finishCommandDrain = (
    failure?: ExecutorFailure,
    drain?: ExecutorDrain
  ) => {
    if (!commands) {
      session.afterDrain?.(failure, drain);
      return;
    }
    commands.output.beginDrain(drain);
    const aborted = failure;
    const inherited = deferredAbort;
    finishTeardowns(failure, drain);
    try {
      session.afterDrain?.(failure, drain);
    } catch (error) {
      commands.output.recordDrainSecondary(error, drain);
    }
    commands.output.afterDrain(inherited ?? aborted, drain);
    if (!failure && aborted) throw aborted.error;
  };
  let ownedPacket:
    | { readonly effects: readonly IViewEffectMsg[]; readonly flags: number }
    | undefined;
  const sink: ViewSink = {
    ownedTransfer(transfer) {
      ownedPacket = { effects: transfer.effects, flags: transfer.flags };
      try {
        commands?.output.observeOwnedTransfer(transfer);
      } catch (error) {
        // A decoder/DOM delivery fault cannot drop native output or replace its
        // original failure. Associate it with the actual running entry instead.
        if (!commands) throw error;
        commands.output.recordSecondary(error, true);
      }
    },
    apply(words, strings, effects) {
      const packet = ownedPacket;
      ownedPacket = undefined;
      const ownPacket = packet?.effects === effects;
      const hadDom = effects.some(
        (effect) =>
          effect.kind === 6 && (effect.code === 12 || effect.code === 2)
      );

      // No arbitrary output callback precedes this transfer-linked token capture.
      const observed = commands
        ? commands.output.observeListenerMetadata(words, strings, effects)
        : {
            effects: effects.filter(
              (effect) => effect.kind !== 6 || effect.code !== 11
            ),
            metadataOnly:
              effects.filter(
                (effect) => effect.kind === 6 && effect.code === 11
              ).length === 1 &&
              effects.some(
                (effect) =>
                  effect.kind === 6 && effect.code === 11 && !effect.flag
              ),
          };
      // Error lease ordinals refer to the native packet including DOM records.
      const leased = commands
        ? commands.output.filter(observed.effects)
        : observed.effects;
      const filtered = commands
        ? commands.output.syncEffects(leased)
        : leased.filter((effect) => effect.kind !== 6 || effect.code !== 12);
      if (disposed) return;
      // Only a pure DOM transport packet is suppressed. Real empty commits,
      // status/IO/error and mixed packets retain the existing apply path.
      if (
        ownPacket &&
        hadDom &&
        packet !== undefined &&
        !(packet.flags & (Flag.Io | Flag.Error | Flag.NeedPeerIds)) &&
        words.length === 0 &&
        strings.length === 0 &&
        filtered.length === 0
      )
        return;
      if (
        observed?.metadataOnly &&
        words.length === 0 &&
        strings.length === 0 &&
        filtered.length === 0
      )
        return;
      if (!view) throw new Error('Native output before view mount');
      if (!view.isMounted) return;
      applyingOutput = true;
      try {
        view.apply(words, strings, filtered);
      } catch (error) {
        rememberPublicationFailure({ kind: 'apply', failure: { error } });
        if (!commands) throw error;
        commands.output.recordSecondary(error, true);
      } finally {
        applyingOutput = false;
      }
    },
    acknowledgeText(input) {
      if (!view) throw new Error('Text input before view mount');
      if (!view.isMounted) return;
      view.acknowledgeText(input);
    },
    acknowledgeSelection(selection) {
      if (!view) throw new Error('Selection input before view mount');
      if (!view.isMounted) return;
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
        if (retireBeforeOutput) {
          retireBeforeOutput = false;
          retire();
        }
        if (flags & Flag.Error)
          rememberPublicationFailure({ kind: 'native-error' });
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
        publicationDrainDepth++;
        if (failure) rememberPublicationFailure({ kind: 'entry', failure });
        if (deferredAbort)
          rememberPublicationFailure({ kind: 'entry', failure: deferredAbort });
        try {
          finishCommandDrain(failure, drain);
        } catch (error) {
          rememberPublicationFailure({ kind: 'cleanup', failure: { error } });
          throw error;
        } finally {
          publicationDrainDepth--;
          if (publicationDrainDepth === 0) {
            const unavailable = publicationFailure;
            publicationFailure = undefined;
            if (unavailable) publications?.unavailable(unavailable);
            else publications?.published();
          }
        }
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
      commandOwner = { dispatcher, owner };
      commands = {
        dispatcher,
        owner,
        output: new NativeEnterOutput(
          running.session,
          dispatcher,
          owner,
          options.onError,
          () => running.metadataReadIdle,
          () => running.runningDrain
        ),
      };
    }
    // No view callbacks have run: actual module/session/owner and idle executor
    // are established, while legacy registry creation alone selects no protocol.
    commands?.output.enableListenerMetadata();
    const port = new SessionPort(running, sink, undefined, commands);
    view = EditorView.mount(
      root,
      port,
      registry,
      commands || publications
        ? {
            ...options,
            onError(error) {
              if (applyingOutput)
                rememberPublicationFailure({
                  kind: 'apply',
                  failure: { error },
                });
              try {
                options.onError(error);
              } catch (failure) {
                if (!applyingOutput || !commands) throw failure;
                commands.output.recordApplyFailure(failure);
              }
            },
          }
        : options
    );
    view.onTeardown(() => {
      // Disposal can run inside a native command callback. Retire only after
      // that receiver returns, before its next output can be transferred.
      retireBeforeOutput = true;
    });
    if (publications)
      view.onTeardown(() => {
        commands?.output.beginTeardown();
        publications.retired();
      });
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
        commands?.output.beginTeardown();
        mounted.beginTeardown();
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
        const observing = commands?.dispatcher.pureInputCommitObserverActive();
        if (commands && (active || observing)) {
          if (active && active.owner === commands.owner) {
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
    publications?.retired();
    authorization.length = 0;
    const failed = view;
    view = undefined;
    for (const cleanup of [
      () => commands?.output.beginTeardown(),
      retire,
      () => failed?.dispose(),
      () => {
        if (commandOwner && executor)
          commandOwner.dispatcher.unregisterOwner(
            executor.session,
            commandOwner.owner
          );
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
        if (commandOwner)
          commandOwner.dispatcher.releaseOwner(
            running.session,
            commandOwner.owner
          );
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
