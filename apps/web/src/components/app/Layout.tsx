import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { SidebarActiveCallWidget } from '@app/features/block-call/sidebar/active-call-widget';
import { useIncomingCallWidgetVisible } from '@app/features/block-call/sidebar/incoming-calls';
import {
  createMenuOpen,
  Launcher,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import {
  AddInboxDialog,
  isAddInboxDialogOpen,
} from '@app/features/inbox/AddInboxDialog';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { InCallPanel } from '@channel/Call/InCallPanel';
import {
  AppSidebar,
  GoToHotkeys,
  type SidebarState,
} from '@components/app/app-sidebar/sidebar';
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
  type JSX,
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

import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import GlobalShortcuts from './GlobalHotkeys';
import { ItemDndProvider } from './ItemDragAndDrop';
import { FloatRegion } from './mobile/float-regions/FloatRegion';
import { FloatRegionHost } from './mobile/float-regions/FloatRegionHost';
import { MobileDockRow } from './mobile/MobileDockRow';
import { MobileViewsRow } from './mobile/MobileViewsRow';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
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

function DraggableCallWidget(props: {
  visible: boolean;
  dragLabel: string;
  defaultBottomGap?: number;
  children: JSX.Element;
}) {
  const EDGE_GAP = 12;
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [dragging, setDragging] = createSignal(false);
  const [position, setPosition] = createSignal<{ left: number; top: number }>();
  const defaultBottomGap = () => props.defaultBottomGap ?? 12;

  const clampPosition = (next: { left: number; top: number }) => {
    const el = root();
    if (!el) return next;

    const maxLeft = Math.max(
      EDGE_GAP,
      window.innerWidth - el.offsetWidth - EDGE_GAP
    );
    const maxTop = Math.max(
      EDGE_GAP,
      window.innerHeight - el.offsetHeight - EDGE_GAP
    );

    return {
      left: Math.min(Math.max(next.left, EDGE_GAP), maxLeft),
      top: Math.min(Math.max(next.top, EDGE_GAP), maxTop),
    };
  };

  const resetToDefaultPosition = (bottomGap = defaultBottomGap()) => {
    const el = root();
    if (!el) return;
    setPosition(
      clampPosition({
        left: Math.round((window.innerWidth - el.offsetWidth) / 2),
        top: window.innerHeight - el.offsetHeight - bottomGap,
      })
    );
  };

  createEffect(() => {
    if (!props.visible) return;
    const bottomGap = defaultBottomGap();
    requestAnimationFrame(() => resetToDefaultPosition(bottomGap));
  });

  createEffect(() => {
    if (!props.visible || !position()) return;

    const handleResize = () => {
      const next = position();
      if (!next) return;
      setPosition(clampPosition(next));
    };

    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    onCleanup(() => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    });
  });

  // Set while a drag is in flight so hiding/unmounting can tear it down; a
  // cancelled pointer (touch interrupted, pointer takeover) never fires
  // pointerup, which would otherwise leave the move listener stuck on window.
  let stopActiveDrag: (() => void) | undefined;

  const startDrag: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (e) => {
    if (!e.isPrimary || e.button !== 0) return;

    const el = root();
    if (!el) return;

    stopActiveDrag?.();
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const pointerStartX = e.clientX;
    const pointerStartY = e.clientY;
    const origin = { left: rect.left, top: rect.top };

    setDragging(true);
    setPosition(origin);

    const handleMove = (moveEvent: PointerEvent) => {
      setPosition(
        clampPosition({
          left: origin.left + (moveEvent.clientX - pointerStartX),
          top: origin.top + (moveEvent.clientY - pointerStartY),
        })
      );
    };

    const stopDrag = () => {
      setDragging(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      if (stopActiveDrag === stopDrag) stopActiveDrag = undefined;
    };
    stopActiveDrag = stopDrag;

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  };

  createEffect(() => {
    if (!props.visible) stopActiveDrag?.();
  });
  onCleanup(() => stopActiveDrag?.());

  return (
    <Show when={props.visible}>
      <div
        ref={setRoot}
        class="fixed z-float w-72 max-w-[calc(100vw-1.5rem)] pointer-events-auto"
        style={{
          left: position() ? `${position()!.left}px` : '50%',
          top: position() ? `${position()!.top}px` : undefined,
          bottom: position() ? undefined : `${defaultBottomGap()}px`,
          transform: position() ? undefined : 'translateX(-50%)',
        }}
      >
        <div class="relative rounded-xl border border-edge-muted bg-surface shadow-menu p-1">
          <button
            type="button"
            aria-label={props.dragLabel}
            class={cn(
              'absolute left-1 right-10 top-1 z-10 h-8 rounded-t-lg rounded-b-md bg-transparent select-none',
              dragging() ? 'cursor-grabbing' : 'cursor-grab'
            )}
            onPointerDown={startDrag}
          />
          {props.children}
        </div>
      </div>
    </Show>
  );
}

function CollapsedSidebarCallWidget(props: { visible: boolean }) {
  return (
    <DraggableCallWidget
      visible={props.visible}
      dragLabel="Drag to move active call controls"
    >
      <InCallPanel isSlim={() => false} />
    </DraggableCallWidget>
  );
}

function CollapsedSidebarIncomingCallWidget(props: {
  visible: boolean;
  activeCallWidgetVisible: boolean;
}) {
  return (
    <DraggableCallWidget
      visible={props.visible}
      dragLabel="Drag to move incoming calls"
      defaultBottomGap={props.activeCallWidgetVisible ? 168 : 12}
    >
      <SidebarActiveCallWidget sidebarState="expanded" />
    </DraggableCallWidget>
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
  const callCtx = useCallContextOptional();
  const incomingCallWidgetVisible = useIncomingCallWidgetVisible();
  const sidebarCollapsed = createMemo(
    () => isSidebarVisible() && sidebarState() === 'slim'
  );
  const activeCallWidgetVisible = createMemo(
    () =>
      isSidebarVisible() &&
      sidebarState() === 'slim' &&
      !!callCtx?.isInCall() &&
      !callCtx?.isCallPage()
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
        {/* The provider spans the sidebar too so its favorites can register
            sortables with the same drag-drop context as the entity drags. */}
        <ItemDndProvider>
          <Show when={isSidebarVisible()}>
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
      </div>
      <CollapsedSidebarIncomingCallWidget
        visible={
          isSidebarVisible() &&
          sidebarState() === 'slim' &&
          incomingCallWidgetVisible()
        }
        activeCallWidgetVisible={activeCallWidgetVisible()}
      />
      <CollapsedSidebarCallWidget visible={activeCallWidgetVisible()} />
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
      <SwipeDownDismissKeyboard />
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
