import { mountGlobalFocusListener } from '@app/signal/focus';
import { useIsAuthenticated } from '@core/auth';
import { Resize } from '@core/component/Resize';
import { usePaywallState } from '@core/constant/PaywallState';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import {
  LAYOUT_CONTEXT_ID,
  setPersistedLayoutSizes,
} from '@core/signal/layout';
import { type RouteSectionProps, useLocation } from '@solidjs/router';
import { attachGlobalDOMScope } from 'core/hotkey/hotkeys';
import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { updateCookie } from '../util/updateCookie';
import Banner from './banner/Banner';
import { GlobalBulkEditEntityModal } from './bulk-edit-entity/BulkEditEntityModal';
import { KommandMenu } from './command/Konsole';
import GlobalShortcuts from './GlobalHotkeys';
import { ItemDndProvider } from './ItemDragAndDrop';
import { createMenuOpen, Launcher, setCreateMenuOpen } from './Launcher';
import { Paywall } from './paywall/Paywall';
import { RightbarWrapper } from './rightbar/Rightbar';
import { SettingsWrapper } from './settings/SettingsWrapper';
import { ShortcutsHelper } from './settings/ShortcutsHelper';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cn } from '@ui/utils/classname';
import { useAppSquishHandlers } from './useAppSquishHandlers';

const AUTH_URLS = [
  '/app/login',
  '/app/login/popup',
  '/app/login/popup/success',
  '/app/onboarding',
  '/app/signup',
  '/app/email-signup-callback',
];

export function Layout(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const { paywallOpen, showPaywall } = usePaywallState();
  const location = useLocation();

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
    if (sessionStorage.getItem('showUpgradeModal') === 'true') {
      showPaywall();
      sessionStorage.removeItem('showUpgradeModal');
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

  attachGlobalDOMScope(document.body);

  return (
    <div
      class={cn(
        'relative flex flex-col justify-between w-dvw h-[calc(var(--dvh,1dvh)*100)]',
        {
          'pb-[max(env(safe-area-inset-bottom,0px),var(--tauri-inset-bottom,0px))]':
            !virtualKeyboardVisible(),
        }
      )}
      style={{
        'padding-top':
          'max(env(safe-area-inset-top, 0px), var(--tauri-inset-top, 0px))',
        'padding-left':
          'max(env(safe-area-inset-left, 0px), var(--tauri-inset-left, 0px))',
        'padding-right':
          'max(env(safe-area-inset-right, 0px), var(--tauri-inset-right, 0px))',
      }}
    >
      <Suspense>
        <Show when={isAuthenticated()}>
          <GlobalShortcuts />
          <Suspense>
            <KommandMenu />
          </Suspense>
          <GlobalBulkEditEntityModal />
          <ShortcutsHelper />
        </Show>
        <Show
          when={
            isAuthenticated() === false &&
            !AUTH_URLS.includes(location.pathname)
          }
        >
          <Banner />
        </Show>
      </Suspense>
      {/* <Show when={isAuthenticated() && isTutorialCompleted() === false}>
        <Onboarding />
      </Show> */}

      <Show when={paywallOpen()}>
        <Paywall />
      </Show>
      <div class="grow-1">
        <Resize.Zone
          gutter={4}
          direction="horizontal"
          class="flex-1 w-full min-h-0 font-sans text-ink caret-accent"
          id={'main-layout'}
        >
          <ItemDndProvider>
            <Resize.Panel id={LAYOUT_CONTEXT_ID} minSize={250}>
              {props.children}
            </Resize.Panel>
            <RightbarWrapper />
            <SettingsWrapper />
          </ItemDndProvider>
        </Resize.Zone>
      </div>
      <Suspense>
        <Show
          when={isAuthenticated() && !AUTH_URLS.includes(location.pathname)}
        >
          <Launcher open={createMenuOpen()} onOpenChange={setCreateMenuOpen} />
        </Show>
      </Suspense>
    </div>
  );
}
