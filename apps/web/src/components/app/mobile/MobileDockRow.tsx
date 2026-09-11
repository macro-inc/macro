import {
  MobileAskAiButton,
  MobileSearchInput,
} from '@app/features/command/mobile/MobileSearchInput';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { useSettingsState } from '@core/constant/SettingsState';
import { triggerFocusInput } from '@core/directive/focusInput';
import CaretUpIcon from '@phosphor/caret-up.svg';
import IconGear from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { MobileDockButton } from './MobileDockButton';
import { MobileDockIsland } from './MobileDockIsland';
import { MobileBottomEdgeFade } from './MobileEdgeFade';
import { MobileTouchMenu } from './MobileTouchMenu';
import { useMobileDockViews } from './mobile-dock-views';
import {
  type MobileDockNavId,
  useForegroundMobileView,
  useMobileNavNavigate,
} from './use-mobile-nav';

function MoreViewsMenu(props: {
  isActive: (id: MobileDockNavId) => boolean;
  onNavigate: (id: MobileDockNavId) => void;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const dockViews = useMobileDockViews();

  return (
    <MobileTouchMenu>
      <MobileTouchMenu.Trigger
        ariaLabel="More views"
        openOnRelease
        icon={CaretUpIcon}
        class="h-(--mobile-chrome-button-size) w-0 min-w-0 flex-1"
        iconClass="size-(--mobile-chrome-icon-size) [&_svg]:size-(--mobile-chrome-icon-size)"
      />
      <MobileTouchMenu.SheetContent aria-label="More views">
        <MobileTouchMenu.Item
          id="settings"
          icon={IconGear}
          active={settingsOpen()}
          animateIcon={false}
          onSelect={toggleSettings}
        >
          Settings
        </MobileTouchMenu.Item>
        <MobileTouchMenu.Separator />
        {/* Only views outside the compact dock belong in the overflow menu. */}
        <For
          each={dockViews()
            .filter((view) => !view.compact)
            .reverse()}
        >
          {(view) => (
            <MobileTouchMenu.Item
              id={view.id}
              icon={view.icon}
              animateIcon={view.animateIcon}
              active={props.isActive(view.id)}
              onSelect={() => props.onNavigate(view.id)}
            >
              {view.label}
            </MobileTouchMenu.Item>
          )}
        </For>
        <MobileTouchMenu.Separator />
        <MobileTouchMenu.Footer>Views</MobileTouchMenu.Footer>
      </MobileTouchMenu.SheetContent>
    </MobileTouchMenu>
  );
}

/**
 * The compact dock — the default bottom row everywhere: one wide island
 * grouping the primary views and More, with Search on its own island.
 * Pressing Search flips the row to the search
 * layout (see MobileDockRow); the current view's button shows in accent.
 */
function MobileCompactDockRow() {
  const navigate = useMobileNavNavigate();
  const foregroundView = useForegroundMobileView();

  const dockViews = useMobileDockViews();
  const navButtons = () => dockViews().filter((view) => view.compact);

  return (
    <div class="flex w-full min-w-0 gap-(--mobile-chrome-gutter)">
      <MobileDockIsland class="h-(--mobile-chrome-button-size) min-w-0 flex-1 justify-between">
        <For each={navButtons()}>
          {(button) => (
            <MobileDockButton
              icon={
                foregroundView() === button.id
                  ? (button.iconActive ?? button.icon)
                  : button.icon
              }
              class="w-0 min-w-0 flex-1 shrink"
              ariaLabel={button.label}
              animateIcon={button.animateIcon}
              active={foregroundView() === button.id}
              onClick={() => navigate(button.id)}
            />
          )}
        </For>
        <MoreViewsMenu
          isActive={(id) => foregroundView() === id}
          onNavigate={navigate}
        />
      </MobileDockIsland>
      <MobileDockIsland class="shrink-0">
        <MobileDockButton
          icon={SearchIcon}
          animateIcon={false}
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
 * The bottom-most chrome row. By default it is the compact dock (see
 * MobileCompactDockRow); pressing its Search button opens a search session,
 * which swaps in the search row — the search bar ("Search or ask AI...")
 * with the "Ask AI" island — and shows the views pill row in the accessory
 * slot above as the scope switcher (see MobileViewsRow). Pressing the
 * input's X ends the session and restores the compact dock.
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
      <Show when={SearchState.isOpen()} fallback={<MobileCompactDockRow />}>
        <MobileSearchInput />
        <MobileAskAiButton />
      </Show>
    </div>
  );
}
