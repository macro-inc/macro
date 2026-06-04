import './MobileDock.css';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { hapticImpact } from '@core/mobile/haptics';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedPlusIcon } from '@icon/wide-plus';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { Popover } from '@kobalte/core/popover';
import CaretUpIcon from '@phosphor/caret-up.svg';
import HomeIcon from '@phosphor/house.svg';
import { useLocation } from '@solidjs/router';
import { cn, Layer } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { setCreateMenuOpen } from '../Launcher';
import { useSplitLayout } from '../split-layout/layout';
import { SearchState } from './mobileSearchState';

const ICON_ANIMATION_DURATION_MS = 500;

type DockId = ListView | 'home';

type IconComponent = Component<
  JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
>;

type MobileDockButtonProps = {
  icon: IconComponent;
  label?: string;
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
      onPointerDown={() => {
        hapticImpact('light');
        if (props.animateIcon !== false) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        }
        props.onClick();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'pointer-events-auto flex items-center justify-center bg-surface text-ink ring ring-edge shadow-md',
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

const MORE_VIEWS: { id: ListView; label: string; icon: IconComponent }[] = [
  { id: 'agents', label: 'Agents', icon: AnimatedStarIcon },
  { id: 'mail', label: 'Email', icon: AnimatedEmailIcon },
  { id: 'documents', label: 'Documents', icon: AnimatedFileMdIcon },
  { id: 'tasks', label: 'Tasks', icon: AnimatedTaskIcon },
  { id: 'channels', label: 'Channels', icon: AnimatedChannelIcon },
  { id: 'calls', label: 'Calls', icon: AnimatedCallIcon },
  { id: 'folders', label: 'Folders', icon: AnimatedFolderIcon },
];

function MorePopover(props: {
  active: boolean;
  isActive: (id: DockId) => boolean;
  onNavigate: (id: DockId) => void;
}) {
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
      if (id) hapticImpact('light');
    }
  };

  const handleTouchEnd = () => {
    const id = hoveredId();
    setHoveredId(null);
    if (isListViewID(id)) {
      props.onNavigate(id);
      setOpen(false);
    }
  };

  return (
    <>
      <MobileDockButton
        icon={CaretUpIcon}
        animateIcon={false}
        active={props.active}
        onClick={() => setOpen((prev) => !prev)}
        ref={setAnchorRef}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        class="size-10 rounded-full"
        iconClass={cn(
          'transition-transform duration-200',
          open() && 'rotate-180'
        )}
      />
      <Popover
        open={open()}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) setHoveredId(null);
        }}
        placement="top-end"
        overflowPadding={10}
        anchorRef={anchorRef}
      >
        <Popover.Portal>
          <Popover.Content class="more-popover-content z-modal pointer-events-auto flex w-52 flex-col gap-1 rounded-sm bg-surface p-1 shadow-lg ring ring-edge">
            <For each={MORE_VIEWS}>
              {(item) => (
                <button
                  type="button"
                  data-more-item={item.id}
                  class={cn(
                    'flex h-11 items-center gap-2 rounded-sm px-3 text-sm',
                    props.isActive(item.id) ? 'text-accent' : 'text-ink',
                    hoveredId() === item.id ? 'bg-hover' : 'hover:bg-hover'
                  )}
                  onClick={() => {
                    hapticImpact('light');
                    props.onNavigate(item.id);
                    setOpen(false);
                  }}
                >
                  <div class="size-4 shrink-0 [&_svg]:size-4">
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
        </Popover.Portal>
      </Popover>
    </>
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

  const isMoreActive = () => MORE_VIEWS.some((v) => isActive(v.id));

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
    <Layer depth={4}>
      <div class="z-mobile-nav-bar pointer-events-none fixed inset-x-0 bottom-0 flex items-center gap-5 px-4 pb-[calc(var(--safe-bottom)+0.5rem)]">
        <MobileDockButton
          icon={HomeIcon}
          animateIcon={false}
          class="size-10 rounded-full"
          active={isActive('home')}
          onClick={() => navigate('home')}
        />
        <MobileDockButton
          icon={AnimatedInboxIcon}
          class="size-10 rounded-full"
          active={isActive('inbox')}
          onClick={() => navigate('inbox')}
        />
        <MobileDockButton
          icon={AnimatedSearchIcon}
          label="Search"
          class="h-10 flex-1 gap-2 rounded-full px-4"
          onClick={() => {
            SearchState.maybeResetState();
            SearchState.open();
          }}
        />
        <MorePopover
          active={isMoreActive()}
          isActive={isActive}
          onNavigate={navigate}
        />
        <MobileDockButton
          icon={AnimatedPlusIcon}
          class="size-10 rounded-full"
          onClick={() => setCreateMenuOpen(true)}
        />
      </div>
    </Layer>
  );
}
