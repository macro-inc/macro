import { CreateContextProvider } from '@app/features/command/context/create-context';
import { SplitRouter } from '@app/lib/split-router';
import { AppProviders } from '@components/app/AppProviders';
import { dismissBootShell } from '@components/app/boot-shell';
import { AppChrome, PageContent } from '@components/app/Layout';
import {
  SplitLayout,
  SplitLayoutProvider,
} from '@components/app/split-layout/SplitLayout';
import { useIsAuthenticated } from '@core/auth';
import { fireAndForget } from '@core/util/fireAndForget';
import { releaseNotificationCover } from '@macro/tauri/push-api';
import { ImperativeDialogHost } from '@ui';
import { type JSX, onCleanup, onMount, type ParentProps, Show } from 'solid-js';
import { LIKELY_NEXT_VIEWS } from './lazy-route-views';
import { PublicBookingShell } from './public-booking-shell';

/** Takes over from index.html's boot shell once this shell has drawn. */
function useDismissBootShell() {
  onMount(dismissBootShell);
}

/** Sign-in, onboarding, invite, and handoff pages: the page alone. */
export function AuthShell(): JSX.Element {
  useDismissBootShell();
  onMount(() =>
    fireAndForget(releaseNotificationCover(), 'notification-launch')
  );
  return (
    <PageContent>
      <ImperativeDialogHost />
      <SplitRouter.Outlet />
    </PageContent>
  );
}

function FocusedPage(props: ParentProps) {
  useDismissBootShell();
  return (
    <div class="min-h-0 flex-1 overflow-y-auto bg-page text-ink">
      <ImperativeDialogHost />
      {props.children}
    </div>
  );
}

/** Booking links keep a native exit outside the lazy page/loading boundary. */
export function FocusedShell(): JSX.Element {
  useDismissBootShell();
  return (
    <PublicBookingShell>
      <ImperativeDialogHost />
      <SplitRouter.Outlet />
    </PublicBookingShell>
  );
}

/**
 * A form's respond page: anonymous visitors get the focused shell, so a public
 * form never hits login; signed-in respondents keep the app chrome around it.
 * While sign-in is unknown the focused shell shows.
 */
export function withFormRespondShell(Page: () => JSX.Element) {
  return function FormRespondShell(): JSX.Element {
    const isAuthenticated = useIsAuthenticated();
    return (
      <Show
        when={isAuthenticated() === true}
        fallback={
          <FocusedPage>
            <Page />
          </FocusedPage>
        }
      >
        <AppProviders>
          <CreateContextProvider focusedPaneId={() => undefined}>
            <AppPage>
              <Page />
            </AppPage>
          </CreateContextProvider>
        </AppProviders>
      </Show>
    );
  };
}

/** A call: full screen, without app chrome. */
export function withMeetingShell(Page: () => JSX.Element) {
  return function MeetingShell(): JSX.Element {
    useDismissBootShell();
    return (
      <PageContent>
        <ImperativeDialogHost />
        <Page />
      </PageContent>
    );
  };
}

function AppPage(props: ParentProps) {
  useDismissBootShell();
  return <AppChrome>{props.children}</AppChrome>;
}

type PreloadableView = { preload: () => Promise<unknown> };
type NetworkInformation = { saveData?: boolean };

/**
 * Warms the likely-next view chunks one at a time while the app is open,
 * leaving startup and hidden tabs alone and skipping Save-Data connections.
 */
function warmRouteViews(views: readonly PreloadableView[]): void {
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection;
  if (connection?.saveData) return;

  const queue = [...views];
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const next = () => {
    const view = disposed ? undefined : queue.shift();
    if (!view) return;
    void view
      .preload()
      .catch(() => {})
      .finally(schedule);
  };
  function schedule() {
    if (disposed || queue.length === 0) return;
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', schedule, { once: true });
      return;
    }
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(next, { timeout: 5000 });
    } else {
      timer = setTimeout(next, 1000);
    }
  }

  // Leave the first seconds to the landing view's own data and chunks.
  timer = setTimeout(schedule, 2500);
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', schedule);
  });
}

/** The app: its chrome around the split layout, which renders every pane. */
export function AppShell(): JSX.Element {
  warmRouteViews(LIKELY_NEXT_VIEWS);
  return (
    <AppProviders>
      <SplitLayoutProvider>
        <AppPage>
          <SplitLayout />
        </AppPage>
      </SplitLayoutProvider>
    </AppProviders>
  );
}
