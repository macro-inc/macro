import { AnimatedInboxIcon } from '@macro-icons/wide/animating/inbox';
import { AnimatedSearchIcon } from '@macro-icons/wide/animating/search';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { hapticImpact } from '@core/mobile/haptics';
import { focusInput } from '@core/directive/focusInput';
import { type Component, createSignal, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@ui/utils/classname';
import { useSplitLayout } from '../split-layout/layout';
import type { ListView } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SearchState } from './mobileSearchState';
import { useLocation } from '@solidjs/router';

false && focusInput;

const ICON_ANIMATION_DURATION_MS = 500;

type MobileDockButtonProps = {
  icon: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
  label?: string;
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
        hapticImpact('light');
        setAnimating(true);
        setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        props.onClick();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'flex flex-col items-center justify-center flex-1 pt-3 pb-2 bg-panel border-t border-edge-muted',
        props.active && 'text-accent'
      )}
    >
      <div class={cn('w-6 h-6 [&_svg]:size-6', props.iconClass)}>
        <Dynamic component={props.icon} triggerAnimation={animating()} />
      </div>
      <Show when={props.label}>
        <span class="text-xs">{props.label}</span>
      </Show>
    </button>
  );
}

function SearchDockButton(props: { active: boolean; onClick: () => void }) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      use:focusInput={{
        getTarget: () => document.getElementById('mobile-search-input'),
      }}
      // This needs to be onClick, rather than pointerDown like the other buttons, so that we can use onClick behavior of focusInput before the dialog overlay appears.
      onClick={() => {
        hapticImpact('light');
        setAnimating(true);
        setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        props.onClick();
      }}
      class={cn(
        'flex flex-col items-center justify-center flex-1 pt-3 pb-2 bg-panel border-t border-edge-muted',
        props.active && 'text-accent'
      )}
    >
      <div class="w-6 h-6 [&_svg]:size-6">
        <Dynamic
          component={AnimatedSearchIcon}
          triggerAnimation={animating()}
        />
      </div>
    </button>
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

  const navigate = (id: ListView) => {
    // If we're already on a soup/component view, replace in-place (mergeHistory)
    // so the tab switch doesn't push a new entry into the swipe-back BG slot.
    // From any other view (document, task, etc.) treat it as forward navigation
    // so the user can swipe back to where they were.
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnSoupView = fgContent?.type === 'component';
    openWithSplit({ type: 'component', id }, { mergeHistory: isOnSoupView });
  };

  return (
    <div class="relative z-mobile-nav-bar flex flex-row justify-between">
      <div class="-z-1 absolute left-0 top-0 right-0 w-screen h-40 bg-panel" />
      <MobileDockButton
        icon={AnimatedInboxIcon}
        active={isActive('inbox')}
        onClick={() => {
          navigate('inbox');
        }}
      />
      <MobileDockButton
        icon={AnimatedEmailIcon}
        active={isActive('mail')}
        onClick={() => navigate('mail')}
      />
      <MobileDockButton
        icon={AnimatedChannelIcon}
        active={isActive('channels')}
        onClick={() => {
          navigate('channels');
        }}
      />
      <MobileDockButton
        icon={AnimatedTaskIcon}
        active={isActive('tasks')}
        onClick={() => navigate('tasks')}
      />
      <MobileDockButton
        icon={AnimatedFileMdIcon}
        active={isActive('documents')}
        onClick={() => navigate('documents')}
      />
      <MobileDockButton
        icon={AnimatedStarIcon}
        active={isActive('agents')}
        onClick={() => navigate('agents')}
      />
      <SearchDockButton
        active={isActive('search')}
        onClick={() => {
          SearchState.maybeResetState();
          SearchState.open();
        }}
      />
    </div>
  );
}
