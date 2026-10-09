import { prepareEmailThreads } from '@app/features/email-thread/preparation-adapter';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableEmailRenderCache } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { createTabLeaderSignal } from '@core/cross-tab/tab-leader';
import { isMobile } from '@core/mobile/isMobile';
import { hasLoginCookie, onLoginStorageChange } from '@core/util/cookies';
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
import { registerEmailPreparationHints } from './hints';
import {
  invalidateEmailRenders,
  registerEmailRenderInvalidation,
} from './lifecycle';
import type { EmailRenderCache } from './service';
import { createEmailRenderSession } from './session-runtime';

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
  /** Resumes an ended viewer only when the server confirms that identity. */
  async function confirmSignedBackIn(ended: string) {
    try {
      // Loaded on demand: this rare path is the provider's only use of it.
      const { fetchUserInfo } = await import('@queries/auth/user-info');
      const info = await fetchUserInfo();
      if (
        info.authenticated &&
        info.id === ended &&
        untrack(endedViewer) === ended
      )
        setEndedViewer(undefined);
    } catch {
      // Unconfirmed: stay ended. A later sign-in or reload resumes caching.
    }
  }
  const viewer = createMemo(() =>
    user.isAuthenticated() === true && user.userId() !== endedViewer()
      ? user.userId()
      : undefined
  );
  // Another tab signing out removes the durable marker: end this viewer here
  // too, even if its broadcast never arrives. Signing in carries no identity,
  // so the ended one resumes only once the server confirms it signed back in.
  onCleanup(
    onLoginStorageChange((signedIn) => {
      const identity = untrack(viewer);
      const ended = untrack(endedViewer);
      if (!signedIn) {
        if (identity) setEndedViewer(identity);
      } else if (ended) void confirmSignedBackIn(ended);
    })
  );
  const [epoch, setEpoch] = createSignal(0);
  // Storage waits for every clear this tab started; results are dropped so
  // the chain does not retain them for the tab's lifetime.
  let barrier: Promise<void> = Promise.resolve();
  const join = (work: Promise<unknown>) => {
    const previous = barrier;
    barrier = (async () => {
      await Promise.allSettled([previous, work]);
    })();
  };
  let resetCurrent:
    | ((sessionEnded: boolean, broadcast: boolean) => Promise<void>)
    | undefined;
  // Kept after disposal: a sign-out confirmed after a 401 already ended the
  // session must still be announced to other tabs.
  let latest: ReturnType<typeof createEmailRenderSession> | undefined;
  const unregister = registerEmailRenderInvalidation(async (reason) => {
    const sessionEnded = reason === 'session-ended';
    const clearing = resetCurrent
      ? resetCurrent(sessionEnded, reason !== 'local')
      : sessionEnded
        ? latest?.invalidate(true)
        : undefined;
    if (clearing) join(clearing);
    // A sign-out pins the ended identity until auth reports signed out. When
    // it already does, there is no session to end and nothing to pin.
    if (sessionEnded) {
      if (user.isAuthenticated() === true) setEndedViewer(user.userId());
    } else setEpoch((value) => value + 1);
    await barrier;
  });
  onCleanup(unregister);
  // Every tab observes a normalized-cache identity reset itself.
  onCleanup(registerCacheResetListener(() => invalidateEmailRenders('local')));

  const enabled = createMemo(() => flag().enabled);
  const native = isTauri();
  // Speculative hydration runs in one tab, and only while enabled.
  const isLeader = createMemo(() =>
    enabled() && !native && navigator.locks
      ? createTabLeaderSignal('email-render-cache:preparation')
      : () => false
  );
  let releaseHydration = () => {};
  function stopHydration() {
    releaseHydration();
    releaseHydration = () => {};
  }
  createEffect(() => {
    if (!enabled()) stopHydration();
  });

  // The session follows the viewer and invalidations, never the flag: a flag
  // that resolves after mount must not clear persisted artifacts or other tabs.
  const session = createMemo(() => {
    epoch();
    const identity = viewer();
    if (!identity || !globalThis.crypto?.subtle) {
      resetCurrent = undefined;
      return;
    }
    // Keep namespace/logout ownership even when the feature is disabled: cold
    // artifacts and another tab's enabled cache still belong to this viewer.
    const session = createEmailRenderSession({
      origin: location.origin,
      environment: import.meta.env.MODE,
      profileScope: getOrCreateCacheScope(),
      viewerId: identity,
      enabled: untrack(enabled),
      native,
      mobile: untrack(isMobile),
      waitForInvalidation: () => barrier,
      isSignedIn: hasLoginCookie,
      onRemoteInvalidation(ended, clearing) {
        join(clearing);
        // Another tab signed out: stop caching for this identity, whatever the
        // flag says now. Auth itself follows the app's own 401 handling.
        if (ended) setEndedViewer(identity);
        else setEpoch((value) => value + 1);
      },
    });
    onCleanup(
      registerEmailPreparationHints((ids) => {
        stopHydration();
        if (!enabled() || !isLeader()()) return;
        releaseHydration = prepareEmailThreads(session.cache, ids, 4, true);
      })
    );

    // Only an explicit sign-out reports a session end; an account switch or
    // an unconfirmed 401 must never sign other tabs out.
    resetCurrent = (ended, broadcast) => session.invalidate(ended, broadcast);
    latest = session;
    onCleanup(() => {
      stopHydration();
      // Account switches and owner disposal clear cold artifacts too. Browser
      // reloads do not run Solid cleanup and therefore retain persistence.
      join(session.dispose());
    });
    return session;
  });
  // A flag that turns on after mount opens storage for the current session.
  createEffect(() => {
    if (enabled()) session()?.cache.initializeStorage();
  });
  const cache = () => (enabled() ? session()?.cache : undefined);
  return (
    <SessionContext.Provider value={cache}>
      {props.children}
    </SessionContext.Provider>
  );
}
