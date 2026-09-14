import { useCreateMenuBlocks } from '@app/features/command/Launcher';
import {
  MobileAskAiButton,
  MobileSearchInput,
} from '@app/features/command/mobile/MobileSearchInput';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { useOpenEventComposer } from '@block-calendar/components/use-open-event-composer';
import { useSettingsState } from '@core/constant/SettingsState';
import { triggerFocusInput } from '@core/directive/focusInput';
import { hapticImpact } from '@core/mobile/haptics';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import CaretUpIcon from '@phosphor/caret-up.svg';
import IconGear from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import CreateIcon from '@phosphor/plus.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FloatRegion } from './float-regions/FloatRegion';
import { MobileDockIsland } from './MobileDockIsland';
import { MobileBottomEdgeFade } from './MobileEdgeFade';
import {
  type MobileTouchIconComponent,
  MobileTouchMenu,
} from './MobileTouchMenu';
import { type MobileDockView, useMobileDockViews } from './mobile-dock-views';
import { mobilePageCreateAction } from './mobile-page-create-action';
import { pressPulse } from './pressPulse';
import {
  type MobileDockNavId,
  useForegroundMobileView,
  useMobileNavNavigate,
} from './use-mobile-nav';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

function MobilePageCreateButton() {
  const foregroundView = useForegroundMobileView();
  const createBlocks = useCreateMenuBlocks();
  const openEventComposer = useOpenEventComposer();
  const action = () => {
    if (foregroundView() === 'calendar') {
      return { label: 'New event', run: () => openEventComposer() };
    }
    return mobilePageCreateAction(foregroundView(), createBlocks());
  };

  return (
    <FloatRegion
      region="accessory"
      priority={-1}
      active={() =>
        !!action() && !SearchState.isOpen() && !virtualKeyboardVisible()
      }
    >
      <Show when={action()}>
        {(create) => (
          <div class="flex justify-end px-(--mobile-chrome-gutter)">
            <MobileDockIsland>
              <MobileDockButton
                icon={CreateIcon}
                ariaLabel={create().label}
                onClick={() => create().run()}
              />
            </MobileDockIsland>
          </div>
        )}
      </Show>
    </FloatRegion>
  );
}

type MobileDockButtonProps = {
  icon: MobileTouchIconComponent;
  /** Accessible name for the icon-only button. */
  ariaLabel: string;
  onClick: () => void;
  active?: boolean;
};

/**
 * Renders flat: hosts wrap it in a MobileDockIsland (alone or grouped with
 * other controls) to give it the floating chrome.
 */
function MobileDockButton(props: MobileDockButtonProps) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      use:pressPulse
      onPointerDown={() => hapticImpact('light')}
      // Fires on release; the press pulse holds the on-state while touched.
      onClick={() => {
        props.onClick();
      }}
      class={cn(
        'relative flex size-(--mobile-chrome-button-size) shrink-0 items-center justify-center rounded-full',
        props.active && 'text-accent'
      )}
    >
      <div class="size-(--mobile-chrome-icon-size) shrink-0 [&_svg]:size-(--mobile-chrome-icon-size)">
        <Dynamic component={props.icon} />
      </div>
    </button>
  );
}

function MoreViewsMenu(props: {
  views: readonly MobileDockView[];
  isActive: (id: MobileDockNavId) => boolean;
  onNavigate: (id: MobileDockNavId) => void;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();

  return (
    <MobileTouchMenu>
      <MobileTouchMenu.Trigger
        ariaLabel="More views"
        icon={CaretUpIcon}
        class="size-(--mobile-chrome-button-size) shrink-0"
        iconClass="size-(--mobile-chrome-icon-size) [&_svg]:size-(--mobile-chrome-icon-size)"
      />
      <MobileTouchMenu.Content>
        <MobileTouchMenu.Item
          id="settings"
          icon={IconGear}
          active={settingsOpen()}
          animateIcon={false}
          onSelect={toggleSettings}
        >
          Settings
        </MobileTouchMenu.Item>
        <Show when={props.views.length > 0}>
          <MobileTouchMenu.Separator />
        </Show>
        <For each={props.views.toReversed()}>
          {(view) => (
            <MobileTouchMenu.Item
              id={view.id}
              icon={view.icon}
              animateIcon={false}
              active={props.isActive(view.id)}
              onSelect={() => props.onNavigate(view.id)}
            >
              {view.label}
            </MobileTouchMenu.Item>
          )}
        </For>
        <MobileTouchMenu.Separator />
        <MobileTouchMenu.Footer>Views</MobileTouchMenu.Footer>
      </MobileTouchMenu.Content>
    </MobileTouchMenu>
  );
}

/**
 * The navigation dock groups as many fixed-size view buttons as fit with More,
 * with Search on its own island.
 * Pressing Search flips the row to the search
 * layout (see MobileDockRow); the current view's button shows in accent.
 */
function MobileNavigationDockRow() {
  const navigate = useMobileNavNavigate();
  const foregroundView = useForegroundMobileView();
  const dockViews = useMobileDockViews();

  const [navRef, setNavRef] = createSignal<HTMLDivElement>();
  const navSize = createElementSize(navRef);
  const visibleCount = () => {
    // The island height and square buttons share the same CSS size. Its width
    // already excludes Search and the gutters; reserve one button for More.
    if (!navSize.height) return 0;
    return Math.max(0, Math.floor(navSize.width / navSize.height) - 1);
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
              onClick={() => navigate(button.id)}
            />
          )}
        </For>
        <MoreViewsMenu
          views={dockViews().slice(visibleCount())}
          isActive={(id) => foregroundView() === id}
          onNavigate={navigate}
        />
      </MobileDockIsland>
      <MobileDockIsland class="shrink-0">
        <MobileDockButton
          icon={SearchIcon}
          ariaLabel="Search"
          onClick={() => {
            // Focus synchronously inside the tap so iOS lets the keyboard
            // open; the input mounts once opening the session flips the row
            // to the search layout.
            triggerFocusInput(() =>
              document.getElementById('mobile-search-input')
            );
            SearchState.open();
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
 * which swaps in the search row — the search bar ("Search or ask AI...")
 * with the "Ask AI" island — and shows the views pill row in the accessory
 * slot above as the scope switcher (see MobileViewsRow). Pressing the
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
      <MobilePageCreateButton />
      <Show when={SearchState.isOpen()} fallback={<MobileNavigationDockRow />}>
        <MobileSearchInput />
        <MobileAskAiButton />
      </Show>
    </div>
  );
}
