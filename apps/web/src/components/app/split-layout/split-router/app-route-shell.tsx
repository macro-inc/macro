import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableNewAppViews } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type Component,
  createRenderEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { SplitContent } from '../layoutManager';
import { useSplitPanelOrThrow } from '../layoutUtils';

export function usePageViewTracking(pageTitle: string) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView(pageTitle);
    analytics.track('open_view', { viewId: pageTitle });
  });
}

export function withAuth<P extends object>(View: Component<P>): Component<P> {
  return (props) => {
    const authenticated = useIsAuthenticated();
    return (
      <Show when={authenticated()} fallback={<LoadingBlock />}>
        <View {...props} />
      </Show>
    );
  };
}

export function RedirectSplit(props: { to: SplitContent }) {
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.replace({ next: props.to }));
  return null;
}

/** App-only feature gating and shell metadata; feature views stay route-agnostic. */
export function NewAppView(props: {
  id: string;
  children: JSX.Element;
  fallback: JSX.Element;
  desktopOnly?: boolean;
  composableOnTouch?: boolean;
  detailRequested?: () => boolean;
  detailFallback?: JSX.Element;
  detailDesktopOnly?: boolean;
}) {
  usePageViewTracking(props.id);
  const panel = useSplitPanelOrThrow();
  const flag = useFeatureFlag(enableNewAppViews);
  const [timedOut, setTimedOut] = createSignal(false);
  const timer = setTimeout(() => setTimedOut(true), 5_000);
  onCleanup(() => clearTimeout(timer));
  const ready = () => !flag().loading || timedOut();
  const enabled = () => ready() && flag().enabled;
  const detailUnsupported = () =>
    Boolean(
      props.detailRequested?.() && props.detailDesktopOnly && isTouchDevice()
    );
  const surfaceSupported = () => !props.desktopOnly || !isTouchDevice();
  const renderModern = () =>
    enabled() && surfaceSupported() && !detailUnsupported();
  const fallback = () => {
    if (!props.detailRequested?.()) return props.fallback;
    const detail = props.detailFallback;
    return detail === undefined ? props.fallback : detail;
  };
  createRenderEffect(() => {
    if (!ready()) return;
    panel.handle.updateMeta?.({
      splitPanelLayout:
        renderModern() && (!isTouchDevice() || props.composableOnTouch)
          ? 'composable'
          : 'legacy',
    });
  });
  return (
    <Show
      when={
        ready() || (props.desktopOnly && isTouchDevice()) || detailUnsupported()
      }
      fallback={<LoadingBlock />}
    >
      <Show when={renderModern()} fallback={fallback()}>
        {props.children}
      </Show>
    </Show>
  );
}
