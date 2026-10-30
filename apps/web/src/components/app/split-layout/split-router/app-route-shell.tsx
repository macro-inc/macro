import { ViewShell } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { isRecord, type PaneId, useSplitRouter } from '@app/lib/split-router';
import { SplitPanel } from '@components/app/split-panel';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { LoginButton } from '@core/component/TopBar/LoginButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EmptyStatePanel } from '@ui';
import {
  type Component,
  type JSX,
  Match,
  onMount,
  type ParentProps,
  Show,
  Suspense,
  Switch,
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

export function SignedOutRoute() {
  return (
    <EmptyStatePanel
      centered
      title="Sign in to view this page"
      description="This page is available after you sign in."
    >
      <LoginButton />
    </EmptyStatePanel>
  );
}

/**
 * Renders `View` once signed in; `Pending`, if given, draws while sign-in is
 * confirmed. A confirmed sign-out shows Login and Sign Up.
 */
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
        <Match when={authenticated() === false}>
          <SignedOutRoute />
        </Match>
        <Match when={Pending && authenticated() === undefined}>
          {Pending && <Pending />}
        </Match>
      </Switch>
    );
  };
}

/**
 * `View` for an account; `Visitor` for a caller with no account, who reads
 * only what a link opens and never mounts the view's account-only lists.
 */
export function withVisitor<P extends object>(
  View: Component<P>,
  Visitor: Component,
  Pending?: Component
): Component<P> {
  const Authenticated = withAuth(View, Pending);
  return (props) => {
    const authenticated = useIsAuthenticated();
    return (
      <Show
        when={authenticated() === false}
        fallback={<Authenticated {...props} />}
      >
        <Visitor />
      </Show>
    );
  };
}

/**
 * The frame a visitor reads one item in: a single panel holding the route's
 * nested detail, with no list or sidebar beside it.
 */
export function VisitorDetail(props: ParentProps) {
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root>
          <ViewShell.Main>
            <Suspense fallback={<LoadingBlock />}>{props.children}</Suspense>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
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
