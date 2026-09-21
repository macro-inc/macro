import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableNewAppViews } from '@core/constant/featureFlags';
import {
  type Component,
  createRenderEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useSplitPanelOrThrow } from './layoutUtils';

export function usePageViewTracking(pageTitle: string) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView(pageTitle);
    analytics.track('open_view', { viewId: pageTitle });
  });
}

const NEW_APP_VIEWS_FLAG_WAIT_MS = 5_000;

export function useNewAppViews(options?: {
  enabledLayout?: () => 'legacy' | 'composable';
}) {
  const panel = useSplitPanelOrThrow();
  const flag = useFeatureFlag(enableNewAppViews);
  const [timedOut, setTimedOut] = createSignal(false);
  const timer = setTimeout(() => setTimedOut(true), NEW_APP_VIEWS_FLAG_WAIT_MS);
  onCleanup(() => clearTimeout(timer));

  // PostHog can be blocked or fail before invoking its flag callback. Bound
  // the loading state so these views fall back to their legacy equivalents
  // instead of displaying a loading block forever.
  const ready = () => !flag().loading || timedOut();
  const enabled = () => ready() && flag().enabled;

  createRenderEffect(() => {
    if (!ready()) return;
    panel.handle.updateMeta?.({
      splitPanelLayout: enabled()
        ? (options?.enabledLayout?.() ?? 'composable')
        : 'legacy',
    });
  });

  return { ready, enabled };
}

/** Delays rendering views that require user context until authentication. */
export const withAuth = <P extends object>(
  Comp: Component<P>
): Component<P> => {
  return (props: P) => {
    const isAuthenticated = useIsAuthenticated();
    return (
      <Show when={isAuthenticated()} fallback={<LoadingBlock />}>
        <Comp {...props} />
      </Show>
    );
  };
};
