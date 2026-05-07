import {
  AppSidebar,
  type SidebarState,
} from '@app/component/app-sidebar/sidebar';
import {
  isSidebarVisible,
  SidebarVisibilityContext,
} from '@app/component/sidebarVisibility';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { AutomationComposer } from '@block-automation/component';
import { useIsAuthenticated } from '@core/auth';
import { usePaywallState } from '@core/constant/PaywallState';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { updateCookie } from '@core/util/cookies';
import { makePersisted } from '@solid-primitives/storage';
import { type RouteSectionProps, useLocation } from '@solidjs/router';
import { cn } from '@ui';
import { attachGlobalDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import Banner from './banner/Banner';
import { GlobalBulkEditEntityModal } from './bulk-edit-entity/BulkEditEntityModal';
import { CommandMenu } from './command';
import { DevStatusBar } from './DevStatusBar';
import GlobalShortcuts from './GlobalHotkeys';
import { GlobalShareModal } from './global-share-modal/GlobalShareModal';
import { ItemDndProvider } from './ItemDragAndDrop';
import { IosShareSheet } from './ios-share-sheet/IosShareSheet';
import { createMenuOpen, Launcher, setCreateMenuOpen } from './Launcher';
import { MacroMcpSetupModal } from './macro-mcp-setup-modal/MacroMcpSetupModal';
import { MobileDock } from './mobile/MobileDock';
import { MobileSearchOuter } from './mobile/MobileSearch';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
import { Paywall } from './paywall/Paywall';
import { PropertyEditorModal } from './property-edit-modal/PropertyEditorModal';
import { useAppSquishHandlers } from './useAppSquishHandlers';

export { isSidebarVisible, SidebarVisibilityContext };

const AUTH_URLS = [
  `${ROUTER_BASE_CONCAT}login`,
  `${ROUTER_BASE_CONCAT}login/popup`,
  `${ROUTER_BASE_CONCAT}login/popup/success`,
  `${ROUTER_BASE_CONCAT}onboarding`,
  `${ROUTER_BASE_CONCAT}signup`,
  `${ROUTER_BASE_CONCAT}email-signup-callback`,
  `${ROUTER_BASE_CONCAT}welcome`,
  `${ROUTER_BASE_CONCAT}team-invite`,
];

export const [sidebarState, setSidebarState] = makePersisted(
  createSignal<SidebarState>(!isMobile() ? 'expanded' : 'hidden'),
  {
    name: 'sidebar-state',
  }
);

export function Layout(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const location = useLocation();
  const sidebarVisible = createMemo(
    () =>
      !isMobile() &&
      isAuthenticated() === true &&
      !AUTH_URLS.includes(location.pathname)
  );

  return (
    <SidebarVisibilityContext.Provider value={sidebarVisible}>
      <LayoutInner {...props} />
    </SidebarVisibilityContext.Provider>
  );
}

function LayoutInner(props: RouteSectionProps) {
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

  mountGlobalFocusListener();

  attachGlobalDOMScope(document.body);

  return (
    <div
      class={cn(
        'relative flex flex-col justify-between w-dvw h-[calc(var(--dvh,1dvh)*100)] pt-(--safe-top) pl-(--safe-left) pr-(--safe-right)',
        {
          'pb-(--safe-bottom)': !virtualKeyboardVisible(),
        }
      )}
    >
      <BundleUpdateProgressBar />
      <Suspense>
        <Show when={isAuthenticated()}>
          <GlobalShortcuts />
          <Show when={!isMobile()}>
            <Suspense>
              <CommandMenu />
            </Suspense>
          </Show>
          <Suspense>
            <PropertyEditorModal />
          </Suspense>
          <GlobalBulkEditEntityModal />
          <GlobalShareModal />
          <IosShareSheet />
          <MacroMcpSetupModal />
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
      <div class="max-h-full grow flex">
        <Show when={isSidebarVisible()}>
          <AppSidebar
            sidebarState={sidebarState()}
            onOpenChange={(open) => {
              if (!open) {
                setSidebarState(isMobile() ? 'hidden' : 'slim');
                return;
              }

              setSidebarState('expanded');
            }}
          />
        </Show>

        <ItemDndProvider>
          <div class="flex-1 w-full min-h-0 font-sans text-ink caret-accent">
            {props.children}
          </div>
        </ItemDndProvider>
      </div>
      <Show
        when={
          isMobile() &&
          !virtualKeyboardVisible() &&
          isAuthenticated() &&
          !AUTH_URLS.includes(location.pathname)
        }
      >
        <MobileDock />
      </Show>
      <Show when={isMobile()}>
        <MobileSearchOuter />
      </Show>
      <SwipeDownDismissKeyboard />
      <Suspense>
        <Show
          when={isAuthenticated() && !AUTH_URLS.includes(location.pathname)}
        >
          <Launcher open={createMenuOpen()} onOpenChange={setCreateMenuOpen} />
          <AutomationComposer />
        </Show>
      </Suspense>
      <DevStatusBar />
    </div>
  );
}
