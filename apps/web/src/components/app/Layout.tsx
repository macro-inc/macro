import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import Banner from '@app/features/auth/banner/Banner';
import { CalendarPermissionPrompt } from '@app/features/auth/CalendarPermissionPrompt';
import { GithubReauthenticationPrompt } from '@app/features/auth/GithubReauthenticationPrompt';
import { GmailReauthenticationPrompt } from '@app/features/auth/GmailReauthenticationPrompt';
import { CommandMenu } from '@app/features/command';
import { FavoritesCommands } from '@app/features/command/FavoritesCommands';
import {
  createMenuOpen,
  Launcher,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import {
  CreateCompanyModal,
  CreateContactModal,
} from '@app/features/crm/crm-create';
import { DevStatusBar } from '@app/features/devtools/DevStatusBar';
import { GlobalBulkEditEntityModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import {
  AddInboxDialog,
  isAddInboxDialogOpen,
} from '@app/features/inbox/AddInboxDialog';
import { MacroMcpSetupModal } from '@app/features/integrations/mcp-setup/MacroMcpSetupModal';
import { AiUsageLimitDialog } from '@app/features/paywall/AiUsageLimitDialog';
import { Paywall } from '@app/features/paywall/Paywall';
import { PropertyEditorModal } from '@app/features/property/editor/PropertyEditorModal';
import { ReminderComposerModal } from '@app/features/reminders/ReminderComposerModal';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { MobileSettings } from '@app/features/settings/MobileSettings';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { NativeShareSheet } from '@app/features/sharing/native-share-sheet/NativeShareSheet';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { CreateChannelModal } from '@channel/CreateChannelModal';
import { GoToHotkeys } from '@components/app/app-sidebar/sidebar';
import { registerMailtoComposerHandler } from '@components/app/mailtoComposerHandler';
import { SidebarRail } from '@components/app/sidebar-next/sidebar-rail';
import {
  isSidebarVisible,
  SidebarVisibilityContext,
} from '@components/app/sidebarVisibility';
import { useIsAuthenticated } from '@core/auth';
import { UserCardDrawer } from '@core/component/UserCardDrawer';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import {
  enableAiUsageBilling,
  enableDatabases,
  enableReminders,
} from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { attachGlobalDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { updateCookie } from '@core/util/cookies';
import { useUserInfoQuery } from '@queries/auth/user-info';
import {
  type RouteSectionProps,
  useLocation,
  useNavigate,
} from '@solidjs/router';
import { cn, ImperativeDialogHost } from '@ui';
import {
  createEffect,
  createMemo,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import { ContentLoading } from './ContentLoading';
import GlobalShortcuts from './GlobalHotkeys';
import { ItemDndProvider } from './ItemDragAndDrop';
import { FloatRegion } from './mobile/float-regions/FloatRegion';
import { FloatRegionHost } from './mobile/float-regions/FloatRegionHost';
import { installGlassPress } from './mobile/glassPress';
import { MobileDockRow } from './mobile/MobileDockRow';
import { MobileViewsRow } from './mobile/MobileViewsRow';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
import { useAppSquishHandlers } from './useAppSquishHandlers';

const StarterDatabase = lazy(async () => {
  const module = await import(
    '@app/features/block-database/views/starter-database'
  );
  return { default: module.StarterDatabase };
});

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
  `${ROUTER_BASE_CONCAT}invite`,
  `${ROUTER_BASE_CONCAT}internal/invite-links`,
];

export function Layout(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const location = useLocation();
  const sidebarVisible = createMemo(
    () =>
      !isTouchDevice() &&
      isAuthenticated() === true &&
      !AUTH_URLS.includes(location.pathname)
  );

  return (
    <SidebarVisibilityContext.Provider value={sidebarVisible}>
      <MobileSettingsProvider>
        <Show when={isAuthenticated() === true}>
          <ShowFeatureFlag flag={enableDatabases}>
            <Suspense>
              <StarterDatabase />
            </Suspense>
          </ShowFeatureFlag>
        </Show>
        <LayoutInner {...props} />
      </MobileSettingsProvider>
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
  const { usageLimitOpen } = useAiUsageLimitState();
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
    onCleanup(installGlassPress());
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
        'relative flex flex-col justify-between not-touch:bg-panel w-dvw h-[calc(var(--dvh,1dvh)*100)] pl-(--safe-left) pr-(--safe-right)'
      )}
    >
      <ImperativeDialogHost />
      <BundleUpdateProgressBar />
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
          <NativeShareSheet />
          <MacroMcpSetupModal />
          <CreateChannelModal />
          <CreateCompanyModal />
          <CreateContactModal />
          {/* Reactive, unlike the imperative isFeatureEnabled(enableReminders) gate on the
              action: this decides whether the composer is mounted at all, so it
              has to pick up a late PostHog answer. */}
          <ShowFeatureFlag flag={enableReminders}>
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
      <ShowFeatureFlag flag={enableAiUsageBilling}>
        <Show when={usageLimitOpen()}>
          <AiUsageLimitDialog />
        </Show>
      </ShowFeatureFlag>
      <div class="max-h-full grow flex">
        <ItemDndProvider>
          <Show when={isSidebarVisible()}>
            <SidebarRail />
          </Show>

          <div class="flex-1 w-full min-h-0 font-sans text-ink caret-current">
            {/* Route loading must not detach the shell or mobile navigation. */}
            <Suspense fallback={<ContentLoading />}>{props.children}</Suspense>
          </div>
        </ItemDndProvider>
      </div>
      <Show
        when={
          isTouchDevice() &&
          isAuthenticated() &&
          !AUTH_URLS.includes(location.pathname)
        }
      >
        <FloatRegionHost />
        <Suspense>
          <UserCardDrawer />
        </Suspense>
        <Show when={isMobile()}>
          <MobileSettings />
        </Show>
        <MobileViewsRow />
        <FloatRegion
          region="dock"
          active={() => !virtualKeyboardVisible() || SearchState.isOpen()}
        >
          <MobileDockRow />
        </FloatRegion>
      </Show>
      <SwipeDownDismissKeyboard />
      <Suspense>
        <Show
          when={isAuthenticated() && !AUTH_URLS.includes(location.pathname)}
        >
          <Launcher open={createMenuOpen()} onOpenChange={setCreateMenuOpen} />
        </Show>
      </Suspense>
      <DevStatusBar />
    </div>
  );
}
