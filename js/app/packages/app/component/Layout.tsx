import { mountGlobalFocusListener } from '@app/signal/focus';
import { useIsAuthenticated } from '@core/auth';
import { Resize } from '@core/component/Resize';
import { useABTest } from '@core/constant/ABTest';
import { usePaywallState } from '@core/constant/PaywallState';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import {
  LAYOUT_CONTEXT_ID,
  setPersistedLayoutSizes,
} from '@core/signal/layout';
import { type RouteSectionProps, useLocation } from '@solidjs/router';
import { attachGlobalDOMScope } from 'core/hotkey/hotkeys';
import { createEffect, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { updateCookie } from '../util/updateCookie';
import Banner from './banner/Banner';
import { KommandMenu } from './command/Konsole';
import { Dock } from './dock/Dock';
import GlobalShortcuts from './GlobalHotkeys';
import { ItemDndProvider } from './ItemDragAndDrop';
import { Paywall } from './paywall/Paywall';
import { QuickCreateMenu } from './QuickCreateMenu';
import { RightbarWrapper } from './rightbar/Rightbar';
import { Settings, setViewportOffset } from './settings/Settings';
import { Launcher, setCreateMenuOpen, createMenuOpen } from './Launcher';

export function Layout(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const { paywallOpen, showPaywall } = usePaywallState();
  const location = useLocation();

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

  // We are tracking viewport height, and using that to set a CSS variable and the viewport offset, so that we can properly constrain the viewport-height for mobile in response to changes such as the virtual keyboard appearing
  const handleResize = () => {
    if (window.visualViewport) {
      // Set the CSS variable with the calculated height
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${window.visualViewport.height}px`
      );

      setViewportOffset(window.visualViewport.offsetTop);
    }
  };

  onMount(() => {
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
      handleResize();
      setViewportOffset(window.visualViewport.offsetTop);
    }

    if (sessionStorage.getItem('showUpgradeModal') === 'true') {
      showPaywall();
      sessionStorage.removeItem('showUpgradeModal');
    }
  });

  onCleanup(() => {
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', handleResize);
      window.visualViewport.removeEventListener('scroll', handleResize);
    }
  });

  // This effect handles transitioning from desktop to mobile width to ensure sidebar state is properly reset
  createEffect((_prevMobileWidth: boolean | undefined) => {
    const currentMobileWidth = isMobileWidth();
    // Note: No longer need to reset resizable context since we use simple boolean signal
    return currentMobileWidth;
  }, isMobileWidth());

  // This effect is to handle moving from unauthenticated to authenticated
  createEffect((prevAuth: boolean | undefined) => {
    const currentAuth = isAuthenticated();
    if (prevAuth === false && currentAuth === true) {
      setPersistedLayoutSizes([1, 0]);
    }
    if (currentAuth === false) {
      setPersistedLayoutSizes([1, 0]);
    }
    return currentAuth;
  }, isAuthenticated());

  mountGlobalFocusListener();

  useABTest();

  attachGlobalDOMScope(document.body);

  return (
    <div class="relative pb-[max(env(safe-area-inset-bottom),var(--tauri-inset-bottom))] pt-[max(env(safe-area-inset-top),var(--tauri-inset-top))] flex flex-col justify-between w-dvw h-dvh">
      <Show when={isAuthenticated()}>
        <GlobalShortcuts />
        <Settings />
        <Suspense>
          <KommandMenu />
        </Suspense>
        <QuickCreateMenu />
      </Show>
      <Show
        when={
          !isAuthenticated() &&
          !['/app/login', '/app/onboarding'].includes(location.pathname)
        }
      >
        <Banner />
      </Show>
      {/* <Show when={isAuthenticated() && isTutorialCompleted() === false}>
        <Onboarding />
      </Show> */}

      <Show when={paywallOpen()}>
        <Paywall />
      </Show>
      <div class="p-2 grow-1">
        <Resize.Zone
          gutter={8}
          direction="horizontal"
          class="flex-1 w-full min-h-0 font-sans text-ink caret-accent"
          id={'main-layout'}
        >
          <ItemDndProvider>
            <Resize.Panel id={LAYOUT_CONTEXT_ID} minSize={250}>
              {props.children}
            </Resize.Panel>
            <RightbarWrapper />
          </ItemDndProvider>
        </Resize.Zone>
      </div>
      <Show when={isAuthenticated() && '/app/onboarding' !== location.pathname}>
        <Dock />
        <Launcher open={createMenuOpen()} onOpenChange={setCreateMenuOpen} />
      </Show>
    </div>
  );
}
