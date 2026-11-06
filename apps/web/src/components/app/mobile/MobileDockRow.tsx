import { ContentLoading } from '@app/components/app/ContentLoading';
import { MobileSearchInput } from '@app/features/command/mobile/MobileSearchInput';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { t } from '@app/lib/i18n';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { triggerFocusInput } from '@core/directive/focusInput';
import { hapticImpact } from '@core/mobile/haptics';
import { lazyNamed } from '@core/util/lazyNamed';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import CaretUpIcon from '@icon/system/regular/caret-up.svg';
import DotsSixVerticalIcon from '@icon/system/regular/dots-six-vertical.svg';
import IconGear from '@icon/system/regular/gear.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { Telemetry } from '@macro-inc/observability';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useNavigationUnread } from '../use-navigation-unread';

import { MobileDockButton } from './MobileDockButton';
import { MobileDockIsland } from './MobileDockIsland';
import { MobileDrawer } from './MobileDrawer';
import { MobileBottomEdgeFade } from './MobileEdgeFade';
import { createMobileDockOrder, dockVisibleCount } from './mobile-dock-order';
import {
  MOBILE_DOCK_VIEWS,
  type MobileDockView,
  useMobileDockViews,
} from './mobile-dock-views';
import {
  type MobileDockNavId,
  useForegroundMobileView,
  useMobileNavNavigate,
} from './use-mobile-nav';

const CustomizeDock = lazyNamed(
  () => import('./CustomizeDock'),
  'CustomizeDock'
);

function MoreViewsDrawer(props: {
  views: readonly MobileDockView[];
  visibleCount: number;
  onMove: (from: number, to: number) => void;
  isActive: (id: MobileDockNavId) => boolean;
  hasUnread: (id: MobileDockNavId) => boolean;
  onNavigate: (id: MobileDockNavId) => void;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const [customizing, setCustomizing] = createSignal(false);
  let customizeButton: HTMLButtonElement | undefined;

  return (
    <MobileDrawer
      side="bottom"
      restoreFocus
      onOpenChange={(open) => {
        if (open) setCustomizing(false);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
      closeOnOutsidePointerStrategy="pointerdown"
    >
      <MobileDrawer.Trigger
        as={MobileDockButton}
        ariaLabel={t('mobile.moreViews')}
        icon={CaretUpIcon}
        // More stands in for the destinations it hides, so it carries the
        // selected state while the foreground view is one of them.
        active={props.views
          .slice(props.visibleCount)
          .some((view) => props.isActive(view.id))}
        unread={props.views
          .slice(props.visibleCount)
          .some((view) => props.hasUnread(view.id))}
      />
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={
            customizing() ? t('mobile.customizeDock') : t('mobile.moreViews')
          }
          targetHeight={customizing() ? 85 : undefined}
        >
          <MobileDrawer.Handle />
          <Show
            when={customizing()}
            fallback={
              <MobileDrawer.ScrollBody>
                <div class="mx-3 flex flex-col gap-1 px-1">
                  <MobileDrawer.Close
                    as={MobileDrawer.Item}
                    aria-label={t('nav.settings')}
                    aria-current={settingsOpen() ? 'page' : undefined}
                    onClick={() => {
                      toggleSettings();
                    }}
                  >
                    <IconGear class="size-4 shrink-0" />
                    <span>{t('nav.settings')}</span>
                  </MobileDrawer.Close>
                  <MobileDrawer.Item
                    ref={customizeButton}
                    aria-label={t('mobile.customizeDock')}
                    onClick={() => setCustomizing(true)}
                  >
                    <DotsSixVerticalIcon class="size-4 shrink-0" />
                    <span>{t('mobile.customizeDock')}</span>
                  </MobileDrawer.Item>
                  <Show when={props.views.length > props.visibleCount}>
                    <div class="-mx-1 h-px shrink-0 bg-edge" />
                  </Show>
                  <For each={props.views.slice(props.visibleCount)}>
                    {(view) => (
                      <MobileDrawer.Close
                        as={MobileDrawer.Item}
                        aria-label={view.label}
                        aria-description={
                          props.hasUnread(view.id)
                            ? t('mobile.unreadItems')
                            : undefined
                        }
                        data-unread={props.hasUnread(view.id) ? '' : undefined}
                        aria-current={
                          props.isActive(view.id) ? 'page' : undefined
                        }
                        onClick={() => {
                          props.onNavigate(view.id);
                        }}
                      >
                        <Dynamic
                          component={view.icon}
                          class="size-4 shrink-0"
                        />
                        <span>{view.label}</span>
                        <Show when={props.hasUnread(view.id)}>
                          <span aria-hidden="true" class="ml-auto">
                            <UnreadIndicator active class="size-1.5" />
                          </span>
                        </Show>
                      </MobileDrawer.Close>
                    )}
                  </For>
                  <div class="-mx-1 h-px shrink-0 bg-edge" />
                  <MobileDrawer.Close
                    aria-label={t('mobile.views')}
                    class="flex h-9 shrink-0 items-center px-3 text-sm font-medium text-ink-muted"
                  >
                    {t('mobile.views')}
                  </MobileDrawer.Close>
                </div>
              </MobileDrawer.ScrollBody>
            }
          >
            <Suspense fallback={<ContentLoading />}>
              <CustomizeDock
                views={props.views}
                visibleCount={props.visibleCount}
                onMove={props.onMove}
                onBack={() => {
                  setCustomizing(false);
                  customizeButton?.focus({ preventScroll: true });
                }}
              />
            </Suspense>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/**
 * The navigation dock groups as many fixed-size view buttons as fit with More,
 * with Search on its own island.
 * Pressing Search flips the row to the search
 * layout (see MobileDockRow); the current view's button stays at full ink
 * while the rest dim.
 */
function MobileNavigationDockRow() {
  const navigate = useMobileNavNavigate();
  const foregroundView = useForegroundMobileView();
  const availableViews = useMobileDockViews();
  const hasUnread = useNavigationUnread();
  const userId = useUserId();
  const preferences = createMemo(() =>
    createMobileDockOrder(
      userId(),
      MOBILE_DOCK_VIEWS.map((view) => view.id)
    )
  );
  const dockViews = createMemo(() => {
    const order = preferences().order();
    return [...availableViews()].sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id)
    );
  });

  const [navRef, setNavRef] = createSignal<HTMLDivElement>();
  const navSize = createElementSize(navRef);
  // The measured island already excludes Search and gutters; reserve More.
  const visibleCount = () =>
    dockVisibleCount(navSize.width, navSize.height, dockViews().length);
  const move = (from: number, to: number) => {
    const span = Telemetry.span('mobile.dock.reorder');
    try {
      span.setAttr('dock.from', from);
      span.setAttr('dock.to', to);
      span.setAttr('dock.visible_count', visibleCount());
      preferences().move(
        from,
        to,
        dockViews().map((view) => view.id)
      );
      hapticImpact('light');
    } finally {
      span.end();
    }
  };

  return (
    <div class="flex w-full justify-between gap-(--mobile-chrome-gutter)">
      <MobileDockIsland
        ref={setNavRef}
        class="h-(--mobile-chrome-button-size) min-w-0 flex-1 justify-between"
        style={{
          'max-width': `calc(${dockViews().length + 1} * var(--mobile-chrome-button-size))`,
        }}
      >
        <For each={dockViews().slice(0, visibleCount())}>
          {(button) => (
            <MobileDockButton
              icon={
                foregroundView() === button.id
                  ? (button.iconActive ?? button.icon)
                  : button.icon
              }
              ariaLabel={button.label}
              active={foregroundView() === button.id}
              unread={hasUnread(button.id)}
              onClick={() => navigate(button.id)}
            />
          )}
        </For>
        <MoreViewsDrawer
          views={dockViews()}
          visibleCount={visibleCount()}
          onMove={move}
          isActive={(id) => foregroundView() === id}
          hasUnread={hasUnread}
          onNavigate={navigate}
        />
      </MobileDockIsland>
      <MobileDockIsland class="shrink-0">
        <MobileDockButton
          icon={SearchIcon}
          ariaLabel={t('nav.search')}
          onClick={() => {
            // Mount the real input first, then focus it in this same user
            // gesture. Deferring the focus transfer can lose iOS keyboard
            // activation when reopening search.
            SearchState.open();
            triggerFocusInput(() =>
              document.getElementById('mobile-search-input')
            );
            navigate('search');
          }}
        />
      </MobileDockIsland>
    </div>
  );
}

type MobileDockRowProps = {
  class?: string;
};

/**
 * The bottom-most chrome row. By default it is the navigation dock (see
 * MobileNavigationDockRow); pressing its Search button opens a search session,
 * which swaps in the search bar; category pills sit at the top of the
 * results (see MobileViewsRow). Pressing the
 * input's X ends the session and restores the navigation dock.
 */
export function MobileDockRow(props: MobileDockRowProps) {
  return (
    <div
      class={cn(
        'flex items-center gap-(--mobile-chrome-gap) px-(--mobile-chrome-gutter)',
        props.class
      )}
    >
      <MobileBottomEdgeFade />
      <Show when={SearchState.isOpen()} fallback={<MobileNavigationDockRow />}>
        <MobileSearchInput />
      </Show>
    </div>
  );
}
