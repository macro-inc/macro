import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineBackgroundDrafts } from '@core/constant/featureFlags';
import { useIsAuthenticated } from '@core/context/user';
import { lazyNamed } from '@core/util/lazyNamed';
import { type ParentProps, Show, Suspense } from 'solid-js';
import {
  createDraftsOnScreen,
  DraftsOnScreenContext,
} from './context/drafts-on-screen';

const RoutineDraftsWatcher = lazyNamed(
  () => import('./routine-drafts-watcher'),
  'RoutineDraftsWatcher'
);

/**
 * Background routine drafts across the app: New routine shows the ones it
 * started, and the watcher reports the rest. Mount once, inside the app's
 * providers.
 */
export function RoutineDraftsHost(props: ParentProps) {
  const background = useFeatureFlag(enableRoutineBackgroundDrafts);
  const authenticated = useIsAuthenticated();
  return (
    <DraftsOnScreenContext.Provider value={createDraftsOnScreen()}>
      <Show when={background().enabled && authenticated() === true}>
        <Suspense>
          <RoutineDraftsWatcher />
        </Suspense>
      </Show>
      {props.children}
    </DraftsOnScreenContext.Provider>
  );
}
