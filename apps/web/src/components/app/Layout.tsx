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
  companyCreation,
  contactCreation,
} from '@app/features/crm/creation-adapter';
import { DevStatusBar } from '@app/features/devtools/DevStatusBar';
import { GlobalBulkEditEntityModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import {
  AddInboxDialog,
  isAddInboxDialogOpen,
} from '@app/features/inbox/AddInboxDialog';
import { MacroMcpSetupModal } from '@app/features/integrations/mcp-setup/MacroMcpSetupModal';
import { AiUsageLimitDialog } from '@app/features/paywall/AiUsageLimitDialog';
import { observeAiUsageLimitMutations } from '@app/features/paywall/ai-usage-limit-handling';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
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
import { enableDatabases } from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { attachGlobalDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { hasLoginCookie, updateCookie } from '@core/util/cookies';
import { lazyNamed } from '@core/util/lazyNamed';
import { isPlatform } from '@core/util/platform';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useLocation, useNavigate } from '@solidjs/router';
import { type as osType } from '@tauri-apps/plugin-os';
import { cn, ImperativeDialogHost } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { ViewNavigationSlotContext } from '../view-shell/navigation-slot';
import { AppProviders } from './AppProviders';
import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import { ContentLoading } from './ContentLoading';
import { DesktopTitleBar } from './DesktopTitleBar';
import GlobalShortcuts from './GlobalHotkeys';
import { InitialInteractiveOnboardingModal } from './InitialInteractiveOnboardingModal';
import { ItemDndProvider } from './ItemDragAndDrop';
import { FloatRegion } from './mobile/float-regions/FloatRegion';
import { FloatRegionHost } from './mobile/float-regions/FloatRegionHost';
import { installGlassPress } from './mobile/glassPress';
import { MobileDockRow } from './mobile/MobileDockRow';
import { MobileViewsRow } from './mobile/MobileViewsRow';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
import { SessionExpiredRedirect } from './SessionExpiredRedirect';
import { useAppSquishHandlers } from './useAppSquishHandlers';

const StarterDatabase = lazy(async () => {
  const module = await import(
    '../../features/block-database/views/starter-database'
  );
  return { default: module.StarterDatabase };
});

// Modals and mobile-only surfaces stay out of the entry chunk; each one
// renders inside a Suspense boundary and loads when it first mounts.
const Paywall = lazyNamed(
  () => import('@app/features/paywall/Paywall'),
  'Paywall'
);
const PropertyEditorModal = lazyNamed(
  () => import('@app/features/property/editor/PropertyEditorModal'),
  'PropertyEditorModal'
);
const MobileSettings = lazyNamed(
  () => import('@app/features/settings/MobileSettings'),
  'MobileSettings'
);
// The CRM create dialogs pull in the database views and table model.
const CreateCompanyModal = lazyNamed(
  () => import('@app/features/crm/crm-create'),
  'CreateCompanyModal'
);
const CreateContactModal = lazyNamed(
  () => import('@app/features/crm/crm-create'),
  'CreateContactModal'
);

/** True from the first time `opened` is, so a dialog loads on first open and can animate closed. */
function hasOpened(opened: () => boolean) {
  return createMemo((seen: boolean) => seen || opened(), false);
}

/**
 * The frame every page renders in: the macOS title bar, dialogs that can open
 * anywhere (the paywall reads mobile settings), and the page itself. App chrome lives in `AppChrome`, inside the
 * routes that show it.
 */
export function RootFrame(props: ParentProps) {
  const hasOverlayTitleBar = isPlatform('desktop') && osType() === 'macos';
  const [navigationSlot, setNavigationSlot] = createSignal<HTMLElement>();
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
      <ViewNavigationSlotContext.Provider value={navigationSlot}>
        <div
          class={cn(
            'relative flex flex-col justify-between not-touch:bg-panel w-dvw h-[calc(var(--dvh,1dvh)*100)] pl-(--safe-left) pr-(--safe-right)',
            hasOverlayTitleBar && 'pt-[40px]'
          )}
        >
          <Show when={hasOverlayTitleBar}>
            <DesktopTitleBar navigationRef={setNavigationSlot} />
          </Show>
          <ImperativeDialogHost />
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
            {/* Route loading must not detach the frame. */}
            <Suspense fallback={<ContentLoading />}>{props.children}</Suspense>
          </div>
          <SwipeDownDismissKeyboard />
          <DevStatusBar />
        </div>
      </ViewNavigationSlotContext.Provider>
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

/**
 * Sends first-time desktop users into the onboarding flow at /onboarding.
 * App chrome runs it, so it fires on any app destination (marketing SSO lands
 * on /app, not /login) and never on the onboarding pages themselves.
 */
function useNewOnboardingRedirect() {
  const userInfoQuery = useUserInfoQuery();
  const navigate = useNavigate();
  const location = useLocation();
  createEffect(() => {
    if (isMobile() || isNativeMobilePlatform()) return;
    // A pending read would suspend the chrome; wait for the user instead.
    const data = userInfoQuery.isSuccess ? userInfoQuery.data : undefined;
    if (data?.authenticated !== true || data.tutorialComplete !== false) {
      return;
    }
    // Preserve the deep link the user arrived on (a shared doc, an invite):
    // onboarding carries it as ?next and its finish() returns there instead of
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
}

/**
 * The app's providers and chrome — rail, hotkeys, command menu, launcher,
 * global modals, and the mobile dock — around a page. The split layout and
 * signed-in form pages render in it; auth, booking, and meeting pages don't.
 */
export function AppChrome(props: ParentProps) {
  const isAuthenticated = useIsAuthenticated();
  // A login cookie shows the rail while sign-in is confirmed; a stale one
  // goes through SessionExpiredRedirect instead of leaving the app blank.
  const sidebarVisible = () =>
    !isTouchDevice() &&
    (isAuthenticated() === true ||
      (isAuthenticated() === undefined && hasLoginCookie()));

  // Route mailto: links (via openExternalUrl) to the in-app email composer.
  registerMailtoComposerHandler();
  useNewOnboardingRedirect();

  const companyDialogUsed = hasOpened(companyCreation.open);
  const contactDialogUsed = hasOpened(
    () => contactCreation.target() !== undefined
  );

  return (
    <AppProviders>
      <SidebarVisibilityContext.Provider value={sidebarVisible}>
        <Show when={isAuthenticated() === true}>
          <ShowFeatureFlag flag={enableDatabases}>
            <Suspense>
              <StarterDatabase />
            </Suspense>
          </ShowFeatureFlag>
        </Show>
        <Suspense>
          <Show when={isAuthenticated()}>
            <GithubReauthenticationPrompt />
            <GmailReauthenticationPrompt />
            <CalendarPermissionPrompt />
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
            <Show when={companyDialogUsed()}>
              <Suspense>
                <CreateCompanyModal />
              </Suspense>
            </Show>
            <Show when={contactDialogUsed()}>
              <Suspense>
                <CreateContactModal />
              </Suspense>
            </Show>
            <Show when={isAddInboxDialogOpen()}>
              <AddInboxDialog />
            </Show>
          </Show>
          <Show when={isAuthenticated() === false}>
            <Show when={hasLoginCookie()} fallback={<Banner />}>
              <SessionExpiredRedirect />
            </Show>
          </Show>
        </Suspense>
        <div class="min-h-0 flex-1 flex">
          <ItemDndProvider>
            <Show when={isSidebarVisible()}>
              <SidebarRail />
            </Show>
            <PageContent>
              {/* Route loading must not detach the chrome or mobile navigation. */}
              <Suspense fallback={<ContentLoading />}>
                {props.children}
              </Suspense>
            </PageContent>
          </ItemDndProvider>
        </div>
        <Show when={isTouchDevice() && isAuthenticated()}>
          <FloatRegionHost />
          <Suspense>
            <UserCardDrawer />
          </Suspense>
          <Show when={isMobile()}>
            <Suspense>
              <MobileSettings />
            </Suspense>
          </Show>
          <MobileViewsRow />
          <FloatRegion
            region="dock"
            active={() => !virtualKeyboardVisible() || SearchState.isOpen()}
          >
            <MobileDockRow />
          </FloatRegion>
        </Show>
        <InitialInteractiveOnboardingModal />
        <Suspense>
          <Show when={isAuthenticated()}>
            <Launcher
              open={createMenuOpen()}
              onOpenChange={setCreateMenuOpen}
            />
          </Show>
        </Suspense>
      </SidebarVisibilityContext.Provider>
    </AppProviders>
  );
}
