import { useAnalytics } from '@app/component/analytics-context';
import type { ListView } from '@app/constants/list-views';
import { hapticImpact } from '@core/mobile/haptics';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedPlusIcon } from '@macro-icons/wide/animating/plus';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { Layer } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { runCreateAction, setCreateMenuOpen } from '../../Launcher';

const ICON_ANIMATION_DURATION_MS = 500;

type IconComponent = Component<
  JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
>;

const VIEW_CREATE_ICONS: Partial<Record<ListView, IconComponent>> = {
  agents: AnimatedStarIcon,
  mail: AnimatedEmailIcon,
  documents: AnimatedPlusIcon,
  tasks: AnimatedTaskIcon,
  channels: AnimatedChannelIcon,
  inbox: AnimatedPlusIcon,
};

export function SoupViewMobileCreateButton(props: {
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
      <Layer depth={1}>
        <button
          type="button"
          class="absolute bottom-4 right-4 z-10 pl-3 pr-4 py-2 rounded-full bg-surface ring text-accent flex items-center justify-center gap-2 shadow-md ring-accent/20"
          onClick={() => {
            hapticImpact('light');
            setAnimating(true);
            setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
            // Defer to next frame to avoid focus race with Dialog
            requestAnimationFrame(() => createAction()?.());
          }}
        >
          <div class="size-5 [&_svg]:size-5">
            <Dynamic component={createIcon()} triggerAnimation={animating()} />
          </div>
          <div>Create</div>
        </button>
      </Layer>
    </Show>
  );
}
