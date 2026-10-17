import { DevStatusBar } from '@app/features/devtools/DevStatusBar';
import { AiUsageLimitDialog } from '@app/features/paywall/AiUsageLimitDialog';
import { observeAiUsageLimitMutations } from '@app/features/paywall/ai-usage-limit-handling';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { usePaywallState } from '@core/constant/PaywallState';
import { attachGlobalDOMScope } from '@core/hotkey/hotkeys';
import { updateCookie } from '@core/util/cookies';
import { lazyNamed } from '@core/util/lazyNamed';
import { isPlatform } from '@core/util/platform';
import { queryClient } from '@queries/client';
import { useLocation } from '@solidjs/router';
import { type as osType } from '@tauri-apps/plugin-os';
import { cn } from '@ui';
import {
  createEffect,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { AppErrorBoundary } from './AppErrorBoundary';
import { AppProviders } from './AppProviders';
import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import { DesktopTitleBar } from './DesktopTitleBar';
import { installGlassPress } from './mobile/glassPress';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
import { useAppSquishHandlers } from './useAppSquishHandlers';

// The paywall stays out of the entry chunk and loads when it first opens.
const Paywall = lazyNamed(
  () => import('@app/features/paywall/Paywall'),
  'Paywall'
);

/**
 * The frame every page renders in: the app's providers, the macOS title bar,
 * dialogs that can open anywhere (the paywall reads mobile settings), and the
 * page itself. Providers live here, not in a shell, so every route gets them.
 * App chrome lives in `AppChrome`, inside the routes that show it.
 */
export function RootFrame(props: ParentProps) {
  const hasOverlayTitleBar = isPlatform('desktop') && osType() === 'macos';
  const { paywallOpen, showPaywall } = usePaywallState();
  const { usageLimitOpen } = useAiUsageLimitState();
  const location = useLocation();

  onCleanup(observeAiUsageLimitMutations(queryClient));

  useAppSquishHandlers();

  // save last_path to cookie
  createEffect(() => {
    const path = location.pathname;
    const currentDate = new Date();
    const oneYearFromNow = new Date(
      currentDate.setFullYear(currentDate.getFullYear() + 1)
    );
    const ONE_YEAR_IN_SECONDS = 31536000;
    updateCookie('last_path', path, {
      maxAge: ONE_YEAR_IN_SECONDS,
      expires: oneYearFromNow,
      path: '/',
      sameSite: 'Lax',
    });
  });

  onMount(() => {
    onCleanup(installGlassPress());
    if (sessionStorage.getItem('showUpgradeModal') === 'true') {
      showPaywall();
      sessionStorage.removeItem('showUpgradeModal');
    }
  });

  mountGlobalFocusListener();

  attachGlobalDOMScope(document.body);

  return (
    <MobileSettingsProvider>
      <AppProviders>
        <div
          class={cn(
            'relative flex flex-col justify-between not-touch:bg-panel w-dvw h-[calc(var(--dvh,1dvh)*100)] pl-(--safe-left) pr-(--safe-right)',
            hasOverlayTitleBar && 'pt-[40px]'
          )}
        >
          <Show when={hasOverlayTitleBar}>
            <DesktopTitleBar />
          </Show>
          <BundleUpdateProgressBar />
          <Show when={paywallOpen()}>
            <Suspense>
              <Paywall />
            </Suspense>
          </Show>
          <Show when={usageLimitOpen()}>
            <AiUsageLimitDialog />
          </Show>
          <div class="min-h-0 flex-1 flex flex-col">
            <AppErrorBoundary name="page" resetKey={() => location.pathname}>
              {/* Route loading must not detach the frame. Routes draw their
                  own loading state, so the frame adds none. */}
              <Suspense>{props.children}</Suspense>
            </AppErrorBoundary>
          </div>
          <SwipeDownDismissKeyboard />
          <DevStatusBar />
        </div>
      </AppProviders>
    </MobileSettingsProvider>
  );
}

/** A page's content area: the space the app chrome or a full-screen shell leaves. */
export function PageContent(props: ParentProps) {
  return (
    <div class="flex-1 w-full min-h-0 font-sans text-ink caret-current">
      {props.children}
    </div>
  );
}
