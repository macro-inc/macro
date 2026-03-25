import './MobileDock.css';
import ChevronUpIcon from '@icon/regular/caret-up.svg?component-solid';
import { AnimatedInboxIcon } from '@macro-icons/wide/animating/inbox';
import { AnimatedSearchIcon } from '@macro-icons/wide/animating/search';
import { AnimatedPlusIcon } from '@macro-icons/wide/animating/plus';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { AnimatedSlidersHorizontalIcon } from '@macro-icons/wide/animating/sliders-horizontal';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { type Component, createSignal, For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Popover } from '@kobalte/core/popover';
import { cn } from '@ui/utils/classname';
import { useSplitLayout } from '../split-layout/layout';
import { SIDEBAR_LINKS } from '../app-sidebar/sidebar';
import { type ListView, isListViewID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SearchState } from './mobileSearchState';
import { useSettingsState } from '@core/constant/SettingsState';
import { setCreateMenuOpen } from '../Launcher';
import { useLocation } from '@solidjs/router';
import { useAnalytics } from '@app/component/analytics-context';

const ICON_ANIMATION_DURATION_MS = 500;

type MobileDockButtonProps = {
  icon: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
  label: string;
  onClick: () => void;
  active?: boolean;
  ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
  onTouchMove?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
  iconClass?: string;
};

function MobileDockButton(props: MobileDockButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      ref={props.ref}
      onPointerDown={() => {
        impactFeedback('light');
        setAnimating(true);
        setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        props.onClick();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'flex flex-col items-center justify-center w-[20%] pt-3 bg-page border-t border-edge-muted',
        props.active && 'text-accent'
      )}
    >
      <div class={cn('w-6 h-6 [&_svg]:size-6', props.iconClass)}>
        <Dynamic component={props.icon} triggerAnimation={animating()} />
      </div>
      <span class="text-xs">{props.label}</span>
    </button>
  );
}

const PRIMARY_IDS = ['inbox', 'channels', 'folders', 'search'] as const;

const MORE_VIEWS = SIDEBAR_LINKS.filter(
  (l) => !(PRIMARY_IDS as readonly string[]).includes(l.id)
).reverse();

function MorePopover(props: {
  active: boolean;
  isActive: (id: ListView) => boolean;
  onNavigate: (id: ListView) => void;
}) {
  const analytics = useAnalytics();
  const { toggleSettings } = useSettingsState();
  const [open, setOpen] = createSignal(false);
  const [anchorRef, setAnchorRef] = createSignal<HTMLElement>();
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);

  const handleTouchMove = (e: TouchEvent) => {
    if (!open()) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const button = el?.closest('[data-more-item]') as HTMLElement | null;
    const id = button?.dataset.moreItem ?? null;
    if (id !== hoveredId()) {
      setHoveredId(id);
      if (id) impactFeedback('light');
    }
  };

  const handleTouchEnd = () => {
    const id = hoveredId();
    setHoveredId(null);
    if (id === 'settings') {
      toggleSettings();
      setOpen(false);
    } else if (id === 'create') {
      analytics.track('create_menu_open', { from: 'mobile_dock' });
      setCreateMenuOpen(true);
      setOpen(false);
    } else if (isListViewID(id)) {
      props.onNavigate(id);
      setOpen(false);
    }
  };

  return (
    <>
      <MobileDockButton
        icon={ChevronUpIcon}
        label="More"
        active={props.active}
        onClick={() => setOpen((prev) => !prev)}
        ref={setAnchorRef}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        iconClass={cn(
          'transition-transform duration-200 [perspective:200px]',
          open() && '[transform:rotateX(180deg)]'
        )}
      />
      <Popover
        open={open()}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) setHoveredId(null);
        }}
        placement="top"
        overflowPadding={10}
        anchorRef={anchorRef}
      >
        <Popover.Content class="more-popover-content -z-2 bg-page border-t border-l border-r border-edge-muted rounded-t-sm flex flex-col gap-1 w-[calc(100vw-20px)] shadow-lg">
          <button
            type="button"
            data-more-item="settings"
            class={cn(
              'flex items-center gap-2 px-3 h-11 text-sm text-ink',
              hoveredId() === 'settings' ? 'bg-hover' : 'hover:bg-hover'
            )}
            onClick={() => {
              impactFeedback('light');
              toggleSettings();
              setOpen(false);
            }}
          >
            <div class="w-4 h-4 shrink-0 [&_svg]:size-4">
              <AnimatedSlidersHorizontalIcon
                triggerAnimation={hoveredId() === 'settings'}
              />
            </div>
            <span>Settings</span>
          </button>
          <button
            type="button"
            data-more-item="create"
            class={cn(
              'flex items-center gap-2 px-3 h-11 text-sm text-ink border-b border-edge-muted',
              hoveredId() === 'create' ? 'bg-hover' : 'hover:bg-hover'
            )}
            onClick={() => {
              impactFeedback('light');
              analytics.track('create_menu_open', { from: 'mobile_dock' });
              setCreateMenuOpen(true);
              setOpen(false);
            }}
          >
            <div class="w-4 h-4 shrink-0 [&_svg]:size-4">
              <AnimatedPlusIcon triggerAnimation={hoveredId() === 'create'} />
            </div>
            <span>Create</span>
          </button>
          <For each={MORE_VIEWS}>
            {(item) => (
              <button
                type="button"
                data-more-item={item.id}
                class={cn(
                  'flex items-center gap-2 px-3 h-11 text-sm',
                  props.isActive(item.id) ? 'text-accent' : 'text-ink',
                  hoveredId() === item.id ? 'bg-hover' : 'hover:bg-hover'
                )}
                onClick={() => {
                  impactFeedback('light');
                  props.onNavigate(item.id);
                  setOpen(false);
                }}
              >
                <div class="w-4 h-4 shrink-0 [&_svg]:size-4">
                  <Dynamic
                    component={item.icon}
                    triggerAnimation={hoveredId() === item.id}
                  />
                </div>
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </Popover.Content>
      </Popover>
    </>
  );
}

export function MobileDock() {
  const { openWithSplit } = useSplitLayout();
  const location = useLocation();

  const isActive = (id: ListView) => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    if (!activeContent) {
      const segments = location.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] === id;
    }
    return activeContent.id === id;
  };

  const isMoreActive = () => MORE_VIEWS.some((v) => isActive(v.id));

  const navigate = (id: ListView) => {
    openWithSplit({ type: 'component', id }, { mergeHistory: true });
  };

  return (
    <div class="relative z-mobile-nav-bar flex flex-row justify-between">
      <div class="-z-1 absolute left-0 top-0 right-0 w-screen h-40 bg-page" />
      <MobileDockButton
        icon={AnimatedInboxIcon}
        label="Inbox"
        active={isActive('inbox')}
        onClick={() => navigate('inbox')}
      />
      <MobileDockButton
        icon={AnimatedChannelIcon}
        label="Channels"
        active={isActive('channels')}
        onClick={() => navigate('channels')}
      />
      <MobileDockButton
        icon={AnimatedFolderIcon}
        label="Files"
        active={isActive('folders')}
        onClick={() => navigate('folders')}
      />
      <MorePopover
        active={isMoreActive()}
        isActive={isActive}
        onNavigate={navigate}
      />
      <MobileDockButton
        icon={AnimatedSearchIcon}
        label="Search"
        onClick={() => {
          SearchState.maybeResetState();
          SearchState.open();
        }}
      />
    </div>
  );
}
