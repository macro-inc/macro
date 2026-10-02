import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useSplitRouter } from '@app/lib/split-router';
import { parseSearchState } from '@app/lib/split-router/search';
import { isRecord } from '@app/lib/split-router/utils';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Component, type JSX, onMount, Show } from 'solid-js';
import type { SplitContent, SplitId } from '../layoutManager';
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
  const router = useSplitRouter<SplitId>();
  onMount(() => {
    const metadata = isRecord(props.to.entryMetadata)
      ? props.to.entryMetadata
      : {};
    panel.handle.replace({
      mergeHistory: props.mergeHistory,
      next: {
        ...props.to,
        entryMetadata: {
          ...metadata,
          search: {
            ...router.location(panel.handle.id)?.search,
            ...parseSearchState(metadata.search),
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
