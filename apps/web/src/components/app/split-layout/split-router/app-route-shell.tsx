import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { isRecord, type PaneId, useSplitRouter } from '@app/lib/split-router';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { usePaneHidden } from '@core/context/pane-visibility';
import {
  type Component,
  createEffect,
  type JSX,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { SplitContent } from '../layoutManager';
import { useSplitPanelOrThrow } from '../layoutUtils';

export function usePageViewTracking(pageTitle: string) {
  const analytics = useAnalytics();
  const hidden = usePaneHidden();
  const track = () => {
    analytics.pageView(pageTitle);
    analytics.track('open_view', { viewId: pageTitle });
  };
  onMount(track);
  // A parked view shown again is opened again, as when it remounted.
  createEffect(
    on(
      hidden,
      (isHidden, wasHidden) => {
        if (wasHidden && !isHidden) track();
      },
      { defer: true }
    )
  );
}

/** Renders `View` once signed in; `Pending`, if given, draws while sign-in is confirmed. */
export function withAuth<P extends object>(
  View: Component<P>,
  Pending?: Component
): Component<P> {
  return (props) => {
    const authenticated = useIsAuthenticated();
    return (
      <Switch fallback={<LoadingBlock />}>
        <Match when={authenticated()}>
          <View {...props} />
        </Match>
        <Match when={Pending && authenticated() === undefined}>
          {Pending && <Pending />}
        </Match>
      </Switch>
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
  detailInlineOnly?: boolean;
}) {
  usePageViewTracking(props.id);
  const inlinePreviewLayout = useInlinePreviewLayout();
  const detailUnsupported = () =>
    Boolean(
      props.detailInlineOnly &&
        props.detailRequested?.() &&
        !inlinePreviewLayout()
    );
  return (
    <Show when={!detailUnsupported()} fallback={props.detailFallback}>
      {props.children}
    </Show>
  );
}
