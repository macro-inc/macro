import { useCreateMenuBlocks } from '@app/features/command/Launcher';
import {
  MobileAskAiButton,
  MobileSearchInput,
} from '@app/features/command/mobile/MobileSearchInput';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { ENABLE_ANIMATED_ICONS } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { triggerFocusInput } from '@core/directive/focusInput';
import { hapticImpact } from '@core/mobile/haptics';
import { openFilePicker } from '@core/util/upload';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import IconGear from '@icon/macro-gear.svg';
import CreateIcon from '@icon/square-pen-create.svg';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedSearchIcon } from '@icon/wide-search';
import BellIcon from '@phosphor/bell-simple.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { MobileDockIsland } from './MobileDockIsland';
import { MobileBottomEdgeFade } from './MobileEdgeFade';
import {
  type MobileTouchIconComponent,
  MobileTouchMenu,
} from './MobileTouchMenu';
import { useMobileDockViews } from './mobile-dock-views';
import { pressPulse } from './pressPulse';
import {
  type MobileDockNavId,
  useForegroundMobileView,
  useMobileNavNavigate,
} from './use-mobile-nav';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

function CreateMenu() {
  const createBlocks = useCreateMenuBlocks();
  const handleFileUpload = useHandleFileUpload();

  // The desktop create menus are the source of truth (useCreateMenuBlocks);
  // rows render top → bottom ending at the thumb, so reverse to keep the
  // desktop order's first entries nearest it.
  const blocks = () => [...createBlocks()].reverse();

  return (
    <MobileDockIsland class="shrink-0 flex justify-center items-center">
      <MobileTouchMenu>
        <MobileTouchMenu.Trigger
          icon={CreateIcon}
          class="size-(--mobile-chrome-button-size)"
          iconClass="size-(--mobile-chrome-icon-size) [&_svg]:size-(--mobile-chrome-icon-size)"
        />
        <MobileTouchMenu.Content>
          <MobileTouchMenu.Item
            id="upload-file"
            icon={UploadIcon}
            animateIcon={false}
            onSelect={() => {
              openFilePicker({ multiple: true }, async (files) => {
                await handleFileUpload(files, false);
              });
            }}
          >
            Upload file
          </MobileTouchMenu.Item>
          {/* Labels key the rows: 'Message' and 'Channel' share a
              blockName. */}
          <For each={blocks()}>
            {(block) => {
              const useAnimatedIcon =
                ENABLE_ANIMATED_ICONS && block.animatedIcon;
              return (
                <MobileTouchMenu.Item
                  id={block.label}
                  icon={useAnimatedIcon ? block.animatedIcon : block.icon}
                  animateIcon={!!useAnimatedIcon}
                  // The block's own action, exactly as the desktop menus
                  // invoke it (e.g. Channel opens the new-channel modal).
                  onSelect={() => block.keyDownHandler?.()}
                >
                  {block.label}
                </MobileTouchMenu.Item>
              );
            }}
          </For>
          <MobileTouchMenu.Separator />
          <MobileTouchMenu.Footer>Create</MobileTouchMenu.Footer>
        </MobileTouchMenu.Content>
      </MobileTouchMenu>
    </MobileDockIsland>
  );
}

type MobileDockButtonProps = {
  icon: MobileTouchIconComponent;
  /** Accessible name for the icon-only button. */
  ariaLabel: string;
  onClick: () => void;
  active?: boolean;
  class?: string;
  /** Plain svg icons (e.g. Bell) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
};

/**
 * Renders flat: hosts wrap it in a MobileDockIsland (alone or grouped with
 * other controls) to give it the floating chrome.
 */
function MobileDockButton(props: MobileDockButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      use:pressPulse
      onPointerDown={() => {
        hapticImpact('light');
        if (props.animateIcon !== false) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        }
      }}
      // Fires on release; the press pulse holds the on-state while touched.
      onClick={() => {
        props.onClick();
      }}
      class={cn(
        'relative flex size-(--mobile-chrome-button-size) shrink-0 items-center justify-center rounded-full',
        props.active && 'text-accent',
        props.class
      )}
    >
      <div class="size-(--mobile-chrome-icon-size) shrink-0 [&_svg]:size-(--mobile-chrome-icon-size)">
        {props.animateIcon === false ? (
          <Dynamic component={props.icon} />
        ) : (
          <Dynamic component={props.icon} triggerAnimation={animating()} />
        )}
      </div>
    </button>
  );
}

function MoreViewsMenu(props: {
  isActive: (id: MobileDockNavId) => boolean;
  onNavigate: (id: MobileDockNavId) => void;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const dockViews = useMobileDockViews();

  return (
    <MobileTouchMenu>
      <MobileTouchMenu.Trigger
        icon={CaretUpIcon}
        class="size-(--mobile-chrome-button-size)"
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
        <MobileTouchMenu.Separator />
        {/* Rows render top → bottom ending at the thumb: reverse the shared
            canonical order so Inbox lands nearest it. */}
        <For each={[...dockViews()].reverse()}>
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
      </MobileTouchMenu.Content>
    </MobileTouchMenu>
  );
}

/**
 * The compact dock — the default bottom row everywhere: one wide island
 * grouping Notifications, Email, Channels, Search, and the Views menu — with
 * Create on its own island. Pressing Search flips the row to the search
 * layout (see MobileDockRow); the current view's button shows in accent.
 */
function MobileCompactDockRow() {
  const navigate = useMobileNavNavigate();
  const foregroundView = useForegroundMobileView();

  const navButtons = (): Array<{
    id: MobileDockNavId;
    label: string;
    icon: MobileTouchIconComponent;
    animateIcon?: boolean;
  }> => [
    {
      id: 'inbox',
      label: 'Notifications',
      icon: BellIcon,
      animateIcon: false,
    },
    { id: 'mail', label: 'Email', icon: AnimatedEmailIcon },
    { id: 'channels', label: 'Channels', icon: AnimatedChannelIcon },
  ];

  return (
    <div class="flex w-full justify-between">
      <MobileDockIsland class="h-(--mobile-chrome-button-size) min-w-0 justify-between gap-(--mobile-chrome-gap)">
        <For each={navButtons()}>
          {(button) => (
            <MobileDockButton
              icon={button.icon}
              ariaLabel={button.label}
              animateIcon={button.animateIcon}
              active={foregroundView() === button.id}
              onClick={() => navigate(button.id)}
            />
          )}
        </For>
        <MobileDockButton
          icon={AnimatedSearchIcon}
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
        <MoreViewsMenu
          isActive={(id) => foregroundView() === id}
          onNavigate={navigate}
        />
      </MobileDockIsland>
      <CreateMenu />
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
