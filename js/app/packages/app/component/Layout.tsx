import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { useIsAuthenticated } from '@core/auth';
import { Resize } from '@core/component/Resize';
import { usePaywallState } from '@core/constant/PaywallState';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import {
  LAYOUT_CONTEXT_ID,
  setPersistedLayoutSizes,
} from '@core/signal/layout';
import { updateCookie } from '@core/util/cookies';
import { type RouteSectionProps, useLocation } from '@solidjs/router';
import { cn } from '@ui/utils/classname';
import { attachGlobalDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import Banner from './banner/Banner';
import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import { GlobalBulkEditEntityModal } from './bulk-edit-entity/BulkEditEntityModal';
import { GlobalShareModal } from './global-share-modal/GlobalShareModal';
import { MacroMcpSetupModal } from './macro-mcp-setup-modal/MacroMcpSetupModal';
import { CommandMenu } from './command';
import GlobalShortcuts from './GlobalHotkeys';
import { ItemDndProvider } from './ItemDragAndDrop';
import { createMenuOpen, Launcher, setCreateMenuOpen } from './Launcher';
import { AutomationComposer } from '@block-automation/component';
import { Paywall } from './paywall/Paywall';
import { PropertyEditorModal } from './property-edit-modal/PropertyEditorModal';
import { SettingsWrapper } from './settings/SettingsWrapper';
import { useAppSquishHandlers } from './useAppSquishHandlers';
import {
  AppSidebar,
  type SidebarState,
} from '@app/component/app-sidebar/sidebar';
import { isMobile } from '@core/mobile/isMobile';
import { MobileDock } from './mobile/MobileDock';
import { MobileSearchOuter } from './mobile/MobileSearch';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
import { makePersisted } from '@solid-primitives/storage';
import {
  SidebarVisibilityContext,
  isSidebarVisible,
} from '@app/component/sidebarVisibility';
export { SidebarVisibilityContext, isSidebarVisible };

const AUTH_URLS = [
  `${ROUTER_BASE_CONCAT}login`,
  `${ROUTER_BASE_CONCAT}login/popup`,
  `${ROUTER_BASE_CONCAT}login/popup/success`,
  `${ROUTER_BASE_CONCAT}onboarding`,
  `${ROUTER_BASE_CONCAT}signup`,
  `${ROUTER_BASE_CONCAT}email-signup-callback`,
  `${ROUTER_BASE_CONCAT}welcome`,
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
        'relative flex flex-col justify-between w-dvw h-[calc(var(--dvh,1dvh)*100)] pt-[var(--safe-top)] pl-[var(--safe-left)] pr-[var(--safe-right)]',
        {
          'pb-[var(--safe-bottom)]': !virtualKeyboardVisible(),
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
      <div class="max-h-full grow-1 flex">
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

        <Resize.Zone
          gutter={2}
          direction="horizontal"
          class="flex-1 w-full min-h-0 font-sans text-ink caret-accent"
          id={'main-layout'}
        >
          <ItemDndProvider>
            <Resize.Panel id={LAYOUT_CONTEXT_ID} minSize={250}>
              {props.children}
            </Resize.Panel>
            <SettingsWrapper />
          </ItemDndProvider>
        </Resize.Zone>
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
    </div>
  );
}
