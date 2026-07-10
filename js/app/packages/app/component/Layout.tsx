import { SidebarActiveCallWidget } from '@app/component/app-sidebar/active-call-widget';
import {
  AppSidebar,
  GoToHotkeys,
  type SidebarState,
} from '@app/component/app-sidebar/sidebar';
import {
  isSidebarVisible,
  SidebarCollapseContext,
  SidebarVisibilityContext,
} from '@app/component/sidebarVisibility';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { AutomationComposer } from '@block-automation/component';
import { InCallPanel, useCallContextOptional } from '@channel/Call';
import { useIsAuthenticated } from '@core/auth';
import { usePaywallState } from '@core/constant/PaywallState';
import { isSoloSettings } from '@core/constant/SettingsState';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { updateCookie } from '@core/util/cookies';
import { makePersisted } from '@solid-primitives/storage';
import { type RouteSectionProps, useLocation } from '@solidjs/router';
import { cn } from '@ui';
import { ScreencastHotkeys } from '@ui/components/ScreencastHotkeys';
import { attachGlobalDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { AddInboxDialog, isAddInboxDialogOpen } from './AddInboxDialog';
import { BundleUpdateProgressBar } from './BundleUpdateProgressBar';
import Banner from './banner/Banner';
import { GlobalBulkEditEntityModal } from './bulk-edit-entity/BulkEditEntityModal';
import { CommandMenu } from './command';
import { FavoritesCommands } from './command/FavoritesCommands';
import { DevStatusBar } from './DevStatusBar';
import { GithubReauthenticationPrompt } from './GithubReauthenticationPrompt';
import GlobalShortcuts from './GlobalHotkeys';
import { GmailReauthenticationPrompt } from './GmailReauthenticationPrompt';
import { GlobalShareModal } from './global-share-modal/GlobalShareModal';
import { ItemDndProvider } from './ItemDragAndDrop';
import { IosShareSheet } from './ios-share-sheet/IosShareSheet';
import { createMenuOpen, Launcher, setCreateMenuOpen } from './Launcher';
import { MacroMcpSetupModal } from './macro-mcp-setup-modal/MacroMcpSetupModal';
import { FloatRegion } from './mobile/float-regions/FloatRegion';
import { FloatRegionHost } from './mobile/float-regions/FloatRegionHost';
import { MobileDock } from './mobile/MobileDock';
import { MobileBottomEdgeFade } from './mobile/MobileEdgeFade';
import { MobileSearchOuter } from './mobile/MobileSearch';
import { SwipeDownDismissKeyboard } from './mobile/SwipeDownDismissKeyboard';
import { Paywall } from './paywall/Paywall';
import { PropertyEditorModal } from './property-edit-modal/PropertyEditorModal';
import { useAppSquishHandlers } from './useAppSquishHandlers';

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

const [sidebarState, setSidebarState] = makePersisted(
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

function CollapsedSidebarCallWidget(props: { visible: boolean }) {
  const EDGE_GAP = 12;
  const DEFAULT_BOTTOM_GAP = 12;
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [dragging, setDragging] = createSignal(false);
  const [position, setPosition] = createSignal<{ left: number; top: number }>();

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

  const resetToDefaultPosition = () => {
    const el = root();
    if (!el) return;
    setPosition(
      clampPosition({
        left: Math.round((window.innerWidth - el.offsetWidth) / 2),
        top: window.innerHeight - el.offsetHeight - DEFAULT_BOTTOM_GAP,
      })
    );
  };

  createEffect(() => {
    if (!props.visible) return;
    requestAnimationFrame(() => resetToDefaultPosition());
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

  const startDrag: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (e) => {
    if (e.button !== 0) return;

    const el = root();
    if (!el) return;

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

    const handleUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <Show when={props.visible}>
      <div
        ref={setRoot}
        class="fixed z-page-overlay w-72 max-w-[calc(100vw-1.5rem)] pointer-events-auto"
        style={{
          left: position() ? `${position()!.left}px` : '50%',
          top: position() ? `${position()!.top}px` : undefined,
          bottom: position() ? undefined : `${DEFAULT_BOTTOM_GAP}px`,
          transform: position() ? undefined : 'translateX(-50%)',
        }}
      >
        <div class="relative rounded-xl border border-edge-muted bg-surface shadow-menu p-1">
          <button
            type="button"
            aria-label="Drag to move active call controls"
            class={cn(
              'absolute left-1 right-10 top-1 z-10 h-8 rounded-t-lg rounded-b-md bg-transparent select-none',
              dragging() ? 'cursor-grabbing' : 'cursor-grab'
            )}
            onPointerDown={startDrag}
          />
          <InCallPanel isSlim={() => false} />
        </div>
      </div>
    </Show>
  );
}

function LayoutInner(props: RouteSectionProps) {
  const isAuthenticated = useIsAuthenticated();
  const { paywallOpen, showPaywall } = usePaywallState();
  const location = useLocation();
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = createSignal(false);
  const [sidebarOverlayTriggerHovered, setSidebarOverlayTriggerHovered] =
    createSignal(false);
  const callCtx = useCallContextOptional();
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
        'relative flex flex-col justify-between w-dvw h-[calc(var(--dvh,1dvh)*100)] pl-(--safe-left) pr-(--safe-right)'
      )}
    >
      <BundleUpdateProgressBar />
      <Suspense>
        <Show when={isAuthenticated()}>
          <Show when={!AUTH_URLS.includes(location.pathname)}>
            <GithubReauthenticationPrompt />
            <GmailReauthenticationPrompt />
          </Show>
          <GlobalShortcuts />
          <Show when={!isMobile()}>
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
        <Paywall />
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
                  setSidebarState(isMobile() ? 'hidden' : 'slim');
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
      <Show when={isSidebarVisible()}>
        <div
          class="fixed bottom-3 z-page-overlay w-64 flex flex-col gap-2 transition-[left] duration-[120ms] ease-in-out"
          style={{
            left: sidebarState() === 'expanded' ? '15.75rem' : '0.75rem',
          }}
        >
          <SidebarActiveCallWidget
            sidebarState="expanded"
            class="rounded-xl border border-edge-muted bg-surface shadow-menu p-1"
          />
        </div>
      </Show>
      <CollapsedSidebarCallWidget
        visible={
          isSidebarVisible() &&
          sidebarState() === 'slim' &&
          !!callCtx?.isInCall() &&
          !callCtx?.isCallPage()
        }
      />
      <Show
        when={
          isMobile() &&
          isAuthenticated() &&
          !AUTH_URLS.includes(location.pathname)
        }
      >
        <FloatRegionHost />
        <FloatRegion region="dock" active={() => !virtualKeyboardVisible()}>
          <MobileBottomEdgeFade />
          <MobileDock />
        </FloatRegion>
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
      <ScreencastHotkeys />
    </div>
  );
}
