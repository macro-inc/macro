import type { ListView } from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  ENABLE_ANIMATED_ICONS,
  ENABLE_SNIPPETS_FLAG,
  ENABLE_SNIPPETS_OVERRIDE,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { triggerFocusInput } from '@core/directive/focusInput';
import { hapticImpact } from '@core/mobile/haptics';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import IconGear from '@icon/macro-gear.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import CaretUpIcon from '@phosphor/caret-up.svg';
import HomeIcon from '@phosphor/house.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useLocation } from '@solidjs/router';
import { cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CREATABLE_BLOCKS, runCreateAction } from '../Launcher';
import { useSplitLayout } from '../split-layout/layout';
import {
  type MobileTouchIconComponent,
  MobileTouchMenu,
} from './MobileTouchMenu';
import { SearchState } from './mobileSearchState';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

type DockId = ListView | 'home';

type MobileDockButtonProps = {
  icon: MobileTouchIconComponent;
  label?: string;
  /** Accessible name for icon-only buttons (falls back to `label`). */
  ariaLabel?: string;
  onClick: () => void;
  active?: boolean;
  ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
  onTouchMove?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
  iconClass?: string;
  class?: string;
  /** Plain svg icons (Home, Caret) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
};

function MobileDockButton(props: MobileDockButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      ref={props.ref}
      aria-label={props.ariaLabel ?? props.label}
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
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'island pointer-events-auto flex items-center justify-center',
        props.active && 'text-accent',
        props.class
      )}
    >
      <div class={cn('size-6 [&_svg]:size-6', props.iconClass)}>
        {props.animateIcon === false ? (
          <Dynamic component={props.icon} />
        ) : (
          <Dynamic component={props.icon} triggerAnimation={animating()} />
        )}
      </div>
      <Show when={props.label}>
        <span class="text-sm font-medium">{props.label}</span>
      </Show>
    </button>
  );
}

const MORE_VIEWS: {
  id: ListView;
  label: string;
  icon: MobileTouchIconComponent;
}[] = [
  { id: 'agents', label: 'Agents', icon: AnimatedStarIcon },
  { id: 'mail', label: 'Email', icon: AnimatedEmailIcon },
  { id: 'documents', label: 'Documents', icon: AnimatedFileMdIcon },
  { id: 'tasks', label: 'Tasks', icon: AnimatedTaskIcon },
  { id: 'channels', label: 'Channels', icon: AnimatedChannelIcon },
  { id: 'calls', label: 'Calls', icon: AnimatedCallIcon },
  { id: 'folders', label: 'Folders', icon: AnimatedFolderIcon },
];

function MoreViewsMenu(props: {
  isActive: (id: DockId) => boolean;
  onNavigate: (id: DockId) => void;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();

  return (
    <MobileTouchMenu
      triggerIcon={CaretUpIcon}
      triggerAriaLabel="More views"
      footerLabel="Views"
      footerCaretClass="mr-11"
      items={[
        {
          id: 'settings',
          label: 'Settings',
          icon: IconGear,
          active: settingsOpen,
          animateIcon: false,
          onSelect: toggleSettings,
        },
        ...MORE_VIEWS.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          active: () => props.isActive(item.id),
          onSelect: () => props.onNavigate(item.id),
        })),
      ]}
    />
  );
}

function CreateMenu() {
  const snippetsFlag = useFeatureFlag(ENABLE_SNIPPETS_FLAG, {
    enabledOverride: ENABLE_SNIPPETS_OVERRIDE,
  });

  const blocks = () =>
    CREATABLE_BLOCKS.filter(
      (block) => block.blockName !== 'snippet' || snippetsFlag().enabled
    ).toReversed();

  return (
    <MobileTouchMenu
      triggerIcon={PlusIcon}
      triggerAriaLabel="Create"
      footerLabel="Create"
      items={blocks().map((block) => {
        const useAnimatedIcon = ENABLE_ANIMATED_ICONS && block.animatedIcon;
        return {
          id: block.blockName,
          label: block.label,
          icon: useAnimatedIcon ? block.animatedIcon : block.icon,
          animateIcon: !!useAnimatedIcon,
          onSelect: () => runCreateAction(block.blockName),
        };
      })}
    />
  );
}

export function MobileDock() {
  const { openWithSplit } = useSplitLayout();
  const location = useLocation();

  const isActive = (id: DockId) => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    if (!activeContent) {
      const segments = location.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] === id;
    }
    return activeContent.id === id;
  };

  const navigate = (id: DockId) => {
    // If we're already on a soup/component view, replace in-place (mergeHistory)
    // so the tab switch doesn't push a new entry into the swipe-back BG slot.
    // From any other view (document, task, etc.) treat it as forward navigation
    // so the user can swipe back to where they were.
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnSoupView = fgContent?.type === 'component';
    openWithSplit({ type: 'component', id }, { mergeHistory: isOnSoupView });
  };

  return (
    <div class="flex items-center gap-3 px-(--mobile-chrome-gutter)">
      <MobileDockButton
        icon={HomeIcon}
        ariaLabel="Home"
        animateIcon={false}
        class="size-10 rounded-full"
        active={isActive('home')}
        onClick={() => navigate('home')}
      />
      <MobileDockButton
        icon={AnimatedInboxIcon}
        ariaLabel="Inbox"
        class="size-10 rounded-full"
        active={isActive('inbox')}
        onClick={() => navigate('inbox')}
      />
      <MobileDockButton
        icon={AnimatedSearchIcon}
        label="Search"
        class="h-10 flex-1 gap-1 rounded-full px-3"
        onClick={() => {
          SearchState.maybeResetState();
          // Arm the focus before opening: iOS only raises the keyboard for a
          // synchronous focus inside the gesture, so triggerFocusInput grabs a
          // temp input now and transfers to the real search input once the
          // dock region portals it in.
          triggerFocusInput(() =>
            document.getElementById('mobile-search-input')
          );
          SearchState.open();
        }}
      />
      <MoreViewsMenu isActive={isActive} onNavigate={navigate} />
      <CreateMenu />
    </div>
  );
}
