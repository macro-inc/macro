import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import {
  createMenuOpen,
  setCreateMenuOpen,
} from '@app/features/command/launcher-state';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { isAddInboxDialogOpen } from '@app/features/inbox/addInboxDialogState';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { mountGlobalFocusListener } from '@app/signal/focus';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import { registerMailtoComposerHandler } from '@components/app/mailtoComposerHandler';
import {
  isSidebarVisible,
  SidebarCollapseContext,
  SidebarVisibilityContext,
} from '@components/app/sidebarVisibility';
import { useIsAuthenticated } from '@core/auth';
import {
  ENABLE_REMINDERS_FLAG,
  ENABLE_REMINDERS_OVERRIDE,
} from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { isSoloSettings } from '@core/constant/SettingsState';
import { attachGlobalDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { updateCookie } from '@core/util/cookies';
import { devPerfLog } from '@core/util/devPerf';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { makePersisted } from '@solid-primitives/storage';
import {
  type RouteSectionProps,
  useLocation,
  useNavigate,
} from '@solidjs/router';
import { cn, ImperativeDialogHost } from '@ui';
import { ScreencastHotkeys } from '@ui/components/ScreencastHotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';

const Banner = lazy(() => import('@app/features/auth/banner/Banner'));
const CalendarPermissionPrompt = lazy(() =>
  import('@app/features/auth/CalendarPermissionPrompt').then((module) => ({
    default: module.CalendarPermissionPrompt,
  }))
);
const GithubReauthenticationPrompt = lazy(() =>
  import('@app/features/auth/GithubReauthenticationPrompt').then((module) => ({
    default: module.GithubReauthenticationPrompt,
  }))
);
const GmailReauthenticationPrompt = lazy(() =>
  import('@app/features/auth/GmailReauthenticationPrompt').then((module) => ({
    default: module.GmailReauthenticationPrompt,
  }))
);
const CommandMenu = lazy(() =>
  import('@app/features/command').then((module) => ({
    default: module.CommandMenu,
  }))
);
const FavoritesCommands = lazy(() =>
  import('@app/features/command/FavoritesCommands').then((module) => ({
    default: module.FavoritesCommands,
  }))
);
const CreateCompanyModal = lazy(() =>
  import('@app/features/companies/CreateCompanyModal').then((module) => ({
    default: module.CreateCompanyModal,
  }))
);
const CreateContactModal = lazy(() =>
  import('@app/features/companies/CreateContactModal').then((module) => ({
    default: module.CreateContactModal,
  }))
);
const DevStatusBar = lazy(() =>
  import('@app/features/devtools/DevStatusBar').then((module) => ({
    default: module.DevStatusBar,
  }))
);
const GlobalBulkEditEntityModal = lazy(() =>
  import('@app/features/entity/bulk-edit/BulkEditEntityModal').then(
    (module) => ({ default: module.GlobalBulkEditEntityModal })
  )
);
const MacroMcpSetupModal = lazy(() =>
  import('@app/features/integrations/mcp-setup/MacroMcpSetupModal').then(
    (module) => ({ default: module.MacroMcpSetupModal })
  )
);
const Paywall = lazy(() =>
  import('@app/features/paywall/Paywall').then((module) => ({
    default: module.Paywall,
  }))
);
const PropertyEditorModal = lazy(() =>
  import('@app/features/property/editor/PropertyEditorModal').then(
    (module) => ({
      default: module.PropertyEditorModal,
    })
  )
);
const ReminderComposerModal = lazy(() =>
  import('@app/features/reminders/ReminderComposerModal').then((module) => ({
    default: module.ReminderComposerModal,
  }))
);
const GlobalShareModal = lazy(() =>
  import('@app/features/sharing/global-share-modal/GlobalShareModal').then(
    (module) => ({ default: module.GlobalShareModal })
  )
);
const IosShareSheet = lazy(() =>
  import('@app/features/sharing/ios-share-sheet/IosShareSheet').then(
    (module) => ({ default: module.IosShareSheet })
  )
);
const AutomationComposer = lazy(() =>
  import('@block-automation/component').then((module) => ({
    default: module.AutomationComposer,
  }))
);
const CreateChannelModal = lazy(() =>
  import('@channel/CreateChannelModal').then((module) => ({
    default: module.CreateChannelModal,
  }))
);
const AppSidebar = lazy(() =>
  import('@components/app/app-sidebar/sidebar').then((module) => ({
    default: module.AppSidebar,
  }))
);
const GoToHotkeys = lazy(() =>
  import('@components/app/app-sidebar/sidebar').then((module) => ({
    default: module.GoToHotkeys,
  }))
);
const AddInboxDialog = lazy(() =>
  import('@app/features/inbox/AddInboxDialog').then((module) => ({
    default: module.AddInboxDialog,
  }))
);
const AuthenticatedCallChrome = lazy(() =>
  import('./AuthenticatedCallChrome').then((module) => ({
    default: module.AuthenticatedCallChrome,
  }))
);
const Launcher = lazy(() =>
  import('@app/features/command/Launcher').then((module) => ({
    default: module.Launcher,
  }))
);
const GlobalShortcuts = lazy(() => import('./GlobalHotkeys'));
const ItemDndProvider = lazy(() =>
  import('./ItemDragAndDrop').then((module) => ({
    default: module.ItemDndProvider,
  }))
);
const MobileDockRow = lazy(() =>
  import('./mobile/MobileDockRow').then((module) => ({
    default: module.MobileDockRow,
  }))
);
const MobileViewsRow = lazy(() =>
  import('./mobile/MobileViewsRow').then((module) => ({
    default: module.MobileViewsRow,
  }))
);
const FloatRegion = lazy(() =>
  import('./mobile/float-regions/FloatRegion').then((module) => ({
    default: module.FloatRegion,
  }))
);
const FloatRegionHost = lazy(() =>
  import('./mobile/float-regions/FloatRegionHost').then((module) => ({
    default: module.FloatRegionHost,
  }))
);
const SwipeDownDismissKeyboard = lazy(() =>
  import('./mobile/SwipeDownDismissKeyboard').then((module) => ({
    default: module.SwipeDownDismissKeyboard,
  }))
);
const BundleUpdateProgressBar = lazy(() =>
  import('./BundleUpdateProgressBar').then((module) => ({
    default: module.BundleUpdateProgressBar,
  }))
);

import { useAppSquishHandlers } from './useAppSquishHandlers';

const AUTH_URLS = [
  `${ROUTER_BASE_CONCAT}login`,
  `${ROUTER_BASE_CONCAT}login/popup`,
  `${ROUTER_BASE_CONCAT}login/popup/success`,
  `${ROUTER_BASE_CONCAT}onboarding`,
  `${ROUTER_BASE_CONCAT}setup`,
  `${ROUTER_BASE_CONCAT}signup`,
  `${ROUTER_BASE_CONCAT}email-signup-callback`,
  `${ROUTER_BASE_CONCAT}welcome`,
  `${ROUTER_BASE_CONCAT}mobile-email-signup`,
  `${ROUTER_BASE_CONCAT}team-invite`,
];

const [sidebarState, setSidebarState] = makePersisted(
  createSignal<SidebarState>(!isTouchDevice() ? 'expanded' : 'hidden'),
  {
    name: 'sidebar-state',
  }
);

export function Layout(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const location = useLocation();
  const sidebarVisible = createMemo(
    () =>
      !isTouchDevice() &&
      isAuthenticated() === true &&
      !AUTH_URLS.includes(location.pathname) &&
      // Settings-as-the-sole-split has its own tab nav — hide app chrome.
      !isSoloSettings()
  );

  return (
    <SidebarVisibilityContext.Provider value={sidebarVisible}>
      <SidebarCollapseContext.Provider
        value={{
          isCollapsed: () => sidebarVisible() && sidebarState() === 'slim',
          expand: () => setSidebarState('expanded'),
        }}
      >
        <LayoutInner {...props} />
      </SidebarCollapseContext.Provider>
    </SidebarVisibilityContext.Provider>
  );
}

/**
 * Sends first-time desktop users into the onboarding flow at /onboarding.
 * Fires from anywhere in the app (marketing SSO lands on /app, not /login),
 * but never off auth/full-screen routes — /onboarding itself included.
 */
function NewOnboardingRedirect() {
  const userInfoQuery = useUserInfoQuery();
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingV4 = useOnboardingV4Flag();

  createEffect(() => {
    if (!onboardingV4().enabled || isMobile() || isNativeMobilePlatform()) {
      return;
    }
    const data = userInfoQuery.data;
    if (data?.authenticated !== true || data.tutorialComplete !== false) {
      return;
    }
    if (AUTH_URLS.includes(location.pathname)) return;
    // Preserve the deep link the user arrived on (a shared doc, an invite):
    // /setup carries it as ?next and its finish() returns there instead of
    // the post-setup landing. Base-relative so navigate() can resolve it
    // against the router.
    const target =
      location.pathname.slice(ROUTER_BASE_CONCAT.length - 1) + location.search;
    const isGenericEntry = target === '/' || target.startsWith(DEFAULT_ROUTE);
    navigate(
      isGenericEntry
        ? '/onboarding'
        : `/onboarding?next=${encodeURIComponent(target)}`,
      { replace: true }
    );
  });

  return null;
}

function LayoutInner(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const { paywallOpen, showPaywall } = usePaywallState();
  const location = useLocation();
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = createSignal(false);
  const [sidebarOverlayTriggerHovered, setSidebarOverlayTriggerHovered] =
    createSignal(false);
  const sidebarCollapsed = createMemo(
    () => isSidebarVisible() && sidebarState() === 'slim'
  );
  let sidebarOverlayCloseTimer: ReturnType<typeof setTimeout> | undefined;

  const clearSidebarOverlayCloseTimer = () => {
    if (sidebarOverlayCloseTimer === undefined) return;
    clearTimeout(sidebarOverlayCloseTimer);
    sidebarOverlayCloseTimer = undefined;
  };

  const setSidebarOverlayOpenGuarded = (open: boolean) => {
    clearSidebarOverlayCloseTimer();
    if (open) {
      setSidebarOverlayOpen(true);
      return;
    }

    sidebarOverlayCloseTimer = setTimeout(() => {
      sidebarOverlayCloseTimer = undefined;
      if (!sidebarOverlayTriggerHovered()) setSidebarOverlayOpen(false);
    }, 120);
  };

  createEffect(() => {
    if (!sidebarCollapsed()) {
      clearSidebarOverlayCloseTimer();
      setSidebarOverlayTriggerHovered(false);
      setSidebarOverlayOpen(false);
    }
  });

  onCleanup(clearSidebarOverlayCloseTimer);

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
    // #region agent log
    devPerfLog('G', 'Layout.tsx:347', 'layout mounted', {
      pathname: window.location.pathname,
      authenticated: isAuthenticated(),
    });
    // #endregion
    if (sessionStorage.getItem('showUpgradeModal') === 'true') {
      showPaywall();
      sessionStorage.removeItem('showUpgradeModal');
    }
  });

  mountGlobalFocusListener();

  // Route mailto: links (via openExternalUrl) to the in-app email composer.
  registerMailtoComposerHandler();

  attachGlobalDOMScope(document.body);

  return (
    <div
      class={cn(
        'relative flex flex-col justify-between w-dvw h-[calc(var(--dvh,1dvh)*100)] pl-(--safe-left) pr-(--safe-right)'
      )}
    >
      <ImperativeDialogHost />
      <Suspense>
        <BundleUpdateProgressBar />
      </Suspense>
      <Suspense>
        <Show when={isAuthenticated()}>
          <NewOnboardingRedirect />
          <Show when={!AUTH_URLS.includes(location.pathname)}>
            <GithubReauthenticationPrompt />
            <GmailReauthenticationPrompt />
            <CalendarPermissionPrompt />
          </Show>
          <GlobalShortcuts />
          <Show when={!isTouchDevice()}>
            <GoToHotkeys />
            <Suspense>
              <FavoritesCommands />
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
          <CreateChannelModal />
          <CreateCompanyModal />
          <CreateContactModal />
          {/* Reactive, unlike the imperative ENABLE_REMINDERS() gate on the
              action: this decides whether the composer is mounted at all, so it
              has to pick up a late PostHog answer. */}
          <ShowFeatureFlag
            key={ENABLE_REMINDERS_FLAG}
            enabledOverride={ENABLE_REMINDERS_OVERRIDE}
          >
            <ReminderComposerModal />
          </ShowFeatureFlag>
          <Show when={isAddInboxDialogOpen()}>
            <AddInboxDialog />
          </Show>
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
        <Suspense>
          <Paywall />
        </Suspense>
      </Show>
      <div class="max-h-full grow flex">
        {/* Drag-drop (and the EntityIcon graph it pulls) is only needed once
            the workspace chrome is up. Login/signup skip it. */}
        <Show
          when={isAuthenticated()}
          fallback={
            <div class="flex-1 w-full min-h-0 font-sans text-ink caret-accent">
              {props.children}
            </div>
          }
        >
          <Suspense
            fallback={
              <div class="flex-1 w-full min-h-0 font-sans text-ink caret-accent">
                {props.children}
              </div>
            }
          >
            <ItemDndProvider>
              <Show when={isSidebarVisible()}>
                <Suspense>
                  <AppSidebar
                    sidebarState={sidebarState()}
                    overlayOpen={sidebarOverlayOpen()}
                    onOverlayOpenChange={setSidebarOverlayOpenGuarded}
                    onOpenChange={(open) => {
                      if (!open) {
                        setSidebarState(isTouchDevice() ? 'hidden' : 'slim');
                        return;
                      }

                      setSidebarState('expanded');
                    }}
                  />
                </Suspense>
              </Show>
              <Show when={sidebarCollapsed()}>
                <div
                  class="fixed left-0 inset-y-0 z-modal-content w-[8px]"
                  onPointerEnter={() => {
                    setSidebarOverlayTriggerHovered(true);
                    setSidebarOverlayOpenGuarded(true);
                  }}
                  onPointerLeave={() => {
                    setSidebarOverlayTriggerHovered(false);
                    setSidebarOverlayOpenGuarded(false);
                  }}
                />
              </Show>
              <div class="flex-1 w-full min-h-0 font-sans text-ink caret-accent">
                {props.children}
              </div>
            </ItemDndProvider>
          </Suspense>
        </Show>
      </div>
      <Show when={isAuthenticated()}>
        <Suspense>
          <AuthenticatedCallChrome
            sidebarVisible={isSidebarVisible()}
            sidebarState={sidebarState()}
          />
        </Suspense>
      </Show>
      <Show
        when={
          isTouchDevice() &&
          isAuthenticated() &&
          !AUTH_URLS.includes(location.pathname)
        }
      >
        <FloatRegionHost />
        <MobileViewsRow />
        <FloatRegion
          region="dock"
          active={() => !virtualKeyboardVisible() || SearchState.isOpen()}
        >
          <MobileDockRow />
        </FloatRegion>
      </Show>
      <Suspense>
        <SwipeDownDismissKeyboard />
      </Suspense>
      <Suspense>
        <Show
          when={isAuthenticated() && !AUTH_URLS.includes(location.pathname)}
        >
          <Launcher open={createMenuOpen()} onOpenChange={setCreateMenuOpen} />
          <AutomationComposer />
        </Show>
      </Suspense>
      <Suspense>
        <DevStatusBar />
      </Suspense>
      <ScreencastHotkeys />
    </div>
  );
}
