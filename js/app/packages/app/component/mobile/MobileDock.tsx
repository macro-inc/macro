import './MobileDock.css';
import { AnimatedInboxIcon } from '@macro-icons/wide/animating/inbox';
import { AnimatedSearchIcon } from '@macro-icons/wide/animating/search';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedPlusIcon } from '@macro-icons/wide/animating/plus';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@ui/utils/classname';
import { useSplitLayout } from '../split-layout/layout';
import { type ListView, isListViewID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SearchState } from './mobileSearchState';
import { runCreateAction, setCreateMenuOpen } from '../Launcher';
import { useLocation } from '@solidjs/router';
import { useAnalytics } from '@app/component/analytics-context';

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
        impactFeedback('light');
        setAnimating(true);
        setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        props.onClick();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'flex flex-col items-center justify-center flex-1 pt-3 pb-2 bg-page border-t border-edge-muted',
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

type IconComponent = MobileDockButtonProps['icon'];

const VIEW_CREATE_ICONS: Partial<Record<ListView, IconComponent>> = {
  agents: AnimatedStarIcon,
  mail: AnimatedEmailIcon,
  documents: AnimatedPlusIcon,
  tasks: AnimatedTaskIcon,
  channels: AnimatedChannelIcon,
  inbox: AnimatedPlusIcon,
};

function FloatingCreateButton(props: {
  activeView: () => ListView | undefined;
}) {
  const analytics = useAnalytics();
  const [animating, setAnimating] = createSignal(false);

  const VIEW_CREATE_ACTIONS: Partial<Record<ListView, () => void>> = {
    agents: () => {
      analytics.track('create_entity', {
        entityType: 'chat',
        source: 'mobile_dock',
      });
      runCreateAction('chat');
    },
    mail: () => {
      analytics.track('create_entity', {
        entityType: 'email',
        source: 'mobile_dock',
      });
      runCreateAction('email');
    },
    documents: () => {
      analytics.track('create_menu_open', { from: 'mobile_dock' });
      setCreateMenuOpen(true);
    },
    tasks: () => {
      analytics.track('create_entity', {
        entityType: 'task',
        source: 'mobile_dock',
      });
      runCreateAction('task');
    },
    channels: () => {
      analytics.track('create_entity', {
        entityType: 'channel',
        source: 'mobile_dock',
      });
      runCreateAction('channel');
    },
  };

  const createAction = createMemo(() => {
    const view = props.activeView();
    if (!view || view === 'search') return undefined;
    return (
      VIEW_CREATE_ACTIONS[view] ??
      (() => {
        analytics.track('create_menu_open', { from: 'mobile_dock' });
        setCreateMenuOpen(true);
      })
    );
  });

  const createIcon = createMemo<IconComponent>(() => {
    const view = props.activeView();
    return (view && VIEW_CREATE_ICONS[view]) ?? AnimatedPlusIcon;
  });

  return (
    <Show when={createAction()}>
      <button
        type="button"
        class="absolute bottom-full right-4 mb-3 w-11 h-11 rounded-full bg-page text-accent flex items-center justify-center shadow-lg"
        onPointerDown={() => {
          impactFeedback('light');
          setAnimating(true);
          setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
          createAction()?.();
        }}
      >
        <div class="w-5 h-5 [&_svg]:size-5">
          <Dynamic component={createIcon()} triggerAnimation={animating()} />
        </div>
      </button>
    </Show>
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

  const activeView = createMemo<ListView | undefined>(() => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    if (activeContent?.type === 'component' && isListViewID(activeContent.id)) {
      return activeContent.id;
    }
    const segments = location.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return isListViewID(last) ? last : undefined;
  });

  const navigate = (id: ListView) => {
    openWithSplit({ type: 'component', id }, { mergeHistory: true });
  };

  return (
    <div class="relative z-mobile-nav-bar flex flex-row justify-between">
      <div class="-z-1 absolute left-0 top-0 right-0 w-screen h-40 bg-page" />
      <FloatingCreateButton activeView={activeView} />
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
      <MobileDockButton
        icon={AnimatedSearchIcon}
        active={isActive('search')}
        onClick={() => {
          SearchState.maybeResetState();
          SearchState.open();
        }}
      />
    </div>
  );
}
