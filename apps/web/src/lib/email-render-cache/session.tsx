import { prepareEmailThreads } from '@app/features/email-thread/preparation-adapter';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { clearLocalAuthSession } from '@core/auth/logout';
import { enableEmailRenderCache } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { isMobile } from '@core/mobile/isMobile';
import { isTauri } from '@core/util/platform';
import { registerCacheResetListener } from '@graphql-cache/lifecycle';
import { getOrCreateCacheScope } from '@graphql-cache/scope';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  untrack,
  useContext,
} from 'solid-js';
import { createPreparationExecutor } from './executor';
import { registerEmailPreparationHints } from './hints';
import { IndexedDbArtifacts } from './indexeddb';
import { digest } from './keys';
import {
  invalidateEmailRenders,
  registerEmailRenderInvalidation,
} from './lifecycle';
import { EmailRenderCache } from './service';
import { storageDeadline } from './store';

const SessionContext = createContext<Accessor<EmailRenderCache | undefined>>(
  () => undefined
);
export const useEmailRenderCache = () => useContext(SessionContext);

/** One service per verified viewer session, shared by every thread/split. */
export function EmailRenderCacheProvider(props: ParentProps) {
  const user = useUserContext();
  const flag = useFeatureFlag(enableEmailRenderCache);
  const [endedViewer, setEndedViewer] = createSignal<string>();
  createEffect(() => {
    if (user.isAuthenticated() === false) setEndedViewer(undefined);
  });
  const viewer = createMemo(() =>
    user.isAuthenticated() === true && user.userId() !== endedViewer()
      ? user.userId()
      : undefined
  );
  const [epoch, setEpoch] = createSignal(0);
  let barrier: Promise<unknown> = Promise.resolve();
  let resetCurrent: ((sessionEnded: boolean) => Promise<void>) | undefined;
  const unregister = registerEmailRenderInvalidation(async (reason) => {
    const sessionEnded = reason === 'session-ended';
    const clearing = resetCurrent?.(sessionEnded);
    if (clearing) barrier = Promise.allSettled([barrier, clearing]);
    if (sessionEnded) setEndedViewer(user.userId());
    else setEpoch((value) => value + 1);
    await barrier;
  });
  onCleanup(unregister);
  onCleanup(registerCacheResetListener(() => invalidateEmailRenders()));

  const cache = createMemo(() => {
    epoch();
    const identity = viewer();
    if (!identity || !globalThis.crypto?.subtle) {
      resetCurrent = undefined;
      return;
    }
    // Keep namespace/logout ownership even when the feature is disabled: cold
    // artifacts and another tab's enabled cache still belong to this viewer.
    const enabled = flag().enabled;
    const scope = getOrCreateCacheScope();
    const namespace = digest(
      JSON.stringify([location.origin, import.meta.env.MODE, scope, identity])
    );
    let store: IndexedDbArtifacts | undefined;
    let invalidated = false;
    let sentSessionEnd = false;
    let channel: BroadcastChannel | undefined;
    let disposed = false;
    const service = new EmailRenderCache({
      memoryBytes: (untrack(isMobile) ? 8 : 16) * 1024 * 1024,
      // Native ships memory-only until IDB and worker origins are verified on
      // actual Tauri/WebKit targets. No eager module worker construction.
      executor: createPreparationExecutor(!isTauri()),
      store: isTauri()
        ? undefined
        : async () => {
            await barrier;
            const name = await namespace;
            if (
              disposed ||
              localStorage.getItem(`email-render-quarantine:${name}`)
            )
              return;
            let budget = (isMobile() ? 32 : 128) * 1024 * 1024;
            const estimate = await storageDeadline(
              navigator.storage?.estimate?.() ?? Promise.resolve(undefined),
              50
            );
            if (estimate?.quota)
              budget = Math.min(
                budget,
                Math.max(0, (estimate.quota - (estimate.usage ?? 0)) / 4)
              );
            if (disposed || budget < 1024 * 1024) return;
            store ??= new IndexedDbArtifacts(name, budget);
            return store;
          },
    });
    // Quota estimation and opening IDB must not start only after a clicked
    // message has been hashed. No parsing or source fetch is triggered here.
    if (enabled) service.initializeStorage();
    const isLeader =
      !enabled || isTauri() || !navigator.locks
        ? () => false
        : createTabLeaderSignal('email-render-cache:preparation');
    let releaseHydration = () => {};
    onCleanup(
      registerEmailPreparationHints((ids) => {
        if (!enabled || !isLeader() || disposed) return;
        releaseHydration();
        releaseHydration = prepareEmailThreads(service, ids, 4, true);
      })
    );

    async function broadcastInvalidation(sessionEnded: boolean) {
      if (sessionEnded && sentSessionEnd) return;
      if (sessionEnded) sentSessionEnd = true;
      const name = await namespace;
      try {
        const sender = new BroadcastChannel(`email-render:${name}`);
        sender.postMessage({ kind: 'invalidate', sessionEnded });
        sender.close();
      } catch {
        /* Storage quarantine still protects subsequent sessions. */
      }
    }

    async function clear(
      broadcast: boolean,
      sessionEnded = false
    ): Promise<void> {
      if (invalidated) {
        // A preceding source reset must not swallow a subsequent logout.
        if (broadcast && sessionEnded) await broadcastInvalidation(true);
        return;
      }
      invalidated = true;
      service.dispose();
      if (!broadcast) {
        store?.close();
        return;
      }
      const name = await namespace;
      await broadcastInvalidation(sessionEnded);
      if (isTauri()) return;
      // A failed/blocked clear leaves this namespace ineligible next session.
      try {
        localStorage.setItem(`email-render-quarantine:${name}`, '1');
      } catch {
        // Persistence is disabled when this storage gate is unavailable, but
        // still attempt to clear artifacts created by an earlier session.
      }
      const target = store ?? new IndexedDbArtifacts(name, 0);
      try {
        const result = await storageDeadline(
          (async () => {
            await target.invalidate();
            return true;
          })(),
          2000
        );
        if (result) localStorage.removeItem(`email-render-quarantine:${name}`);
      } catch {
        /* Quarantine remains when storage is inaccessible. */
      } finally {
        target.close();
      }
    }

    async function connect(): Promise<void> {
      const name = await namespace;
      if (disposed || typeof BroadcastChannel === 'undefined') return;
      try {
        channel = new BroadcastChannel(`email-render:${name}`);
      } catch {
        return;
      }
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data as {
          kind?: string;
          sessionEnded?: boolean;
        } | null;
        if (message?.kind !== 'invalidate') return;
        barrier = clear(false);
        // Another tab ending this identity must not repersist its cached source
        // under the newly cleared generation while auth revalidation catches up.
        if (message.sessionEnded) {
          setEndedViewer(identity);
          void clearLocalAuthSession();
        } else setEpoch((value) => value + 1);
      };
    }
    void connect();
    resetCurrent = (sessionEnded) =>
      clear(
        true,
        sessionEnded ||
          user.isAuthenticated() !== true ||
          user.userId() !== identity
      );
    onCleanup(() => {
      disposed = true;
      releaseHydration();
      service.dispose();
      // Account switches and gate changes must clear cold entries too. A normal
      // browser reload does not run Solid disposal and retains persistence.
      const sessionEnded =
        user.isAuthenticated() !== true || user.userId() !== identity;
      if (!invalidated || sessionEnded)
        barrier = Promise.allSettled([barrier, clear(true, sessionEnded)]);
      channel?.close();
    });
    return enabled ? service : undefined;
  });
  return (
    <SessionContext.Provider value={cache}>
      {props.children}
    </SessionContext.Provider>
  );
}
