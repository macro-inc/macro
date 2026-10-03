import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { isRecord, type PaneId, useSplitRouter } from '@app/split-router';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Component, type JSX, onMount, Show } from 'solid-js';
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

export function RedirectSplit(props: {
  to: SplitContent;
  mergeHistory?: boolean;
}) {
  const panel = useSplitPanelOrThrow();
  const router = useSplitRouter();
  onMount(() => {
    const metadata = isRecord(props.to.entryMetadata)
      ? props.to.entryMetadata
      : {};
    const pane = panel.handle.id as string as PaneId;
    const savedSearch = isRecord(metadata.search) ? metadata.search : {};
    panel.handle.replace({
      mergeHistory: props.mergeHistory,
      next: {
        ...props.to,
        entryMetadata: {
          ...metadata,
          search: {
            ...router.entry(pane)?.location.search,
            ...savedSearch,
          },
        },
      },
    });
  });
  return null;
}

/** App-only page tracking and detail gating; feature views stay route-agnostic. */
export function AppView(props: {
  id: string;
  children: JSX.Element;
  detailRequested?: () => boolean;
  detailFallback?: JSX.Element;
  detailDesktopOnly?: boolean;
}) {
  usePageViewTracking(props.id);
  const detailUnsupported = () =>
    Boolean(
      props.detailRequested?.() && props.detailDesktopOnly && isTouchDevice()
    );
  return (
    <Show when={!detailUnsupported()} fallback={props.detailFallback}>
      {props.children}
    </Show>
  );
}
