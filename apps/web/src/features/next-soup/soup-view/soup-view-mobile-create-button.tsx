import type { ListView } from '@app/constants/list-views';
import {
  runCreateAction,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { openCreateCompanyModal } from '@app/features/companies/CreateCompanyModal';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { hapticImpact } from '@core/mobile/haptics';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedPlusIcon } from '@icon/wide-plus';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { cn, Layer } from '@ui';
import {
  type Accessor,
  type Component,
  createMemo,
  createSignal,
  type JSX,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  MOBILE_FLOATING_BUTTON_OFFSCREEN_RIGHT,
  MOBILE_FLOATING_BUTTON_TRANSITION,
  MOBILE_FLOATING_BUTTON_VISIBLE,
} from './soup-view-mobile-floating-motion';

type IconComponent = Component<
  JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
>;

const VIEW_CREATE_ICONS: Partial<Record<ListView, IconComponent>> = {
  agents: AnimatedStarIcon,
  mail: AnimatedEmailIcon,
  documents: AnimatedPlusIcon,
  tasks: AnimatedTaskIcon,
  channels: AnimatedChannelIcon,
  companies: AnimatedCompanyIcon,
  inbox: AnimatedPlusIcon,
};

export function SoupViewMobileCreateButton(props: {
  activeView: () => ListView | undefined;
  visible?: Accessor<boolean>;
}) {
  const analytics = useAnalytics();
  const [animating, setAnimating] = createSignal(false);

  // Entity creation analytics fire at the data-layer chokepoints (create.ts
  // etc.) once the entity actually exists; the dock only attributes `source`.
  const VIEW_CREATE_ACTIONS: Partial<Record<ListView, () => void>> = {
    agents: () => {
      runCreateAction('chat', { source: 'mobile_dock' });
    },
    mail: () => {
      runCreateAction('email', { source: 'mobile_dock' });
    },
    documents: () => {
      analytics.track('create_menu_open', { from: 'mobile_dock' });
      setCreateMenuOpen(true);
    },
    tasks: () => {
      runCreateAction('task', { source: 'mobile_dock' });
    },
    channels: () => {
      openNewChannelModal();
    },
    companies: () => {
      openCreateCompanyModal();
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

  const isVisible = () => (props.visible?.() ?? true) && !!createAction();

  return (
    <Layer depth={3}>
      <button
        type="button"
        class={cn(
          'absolute bottom-4 right-4 z-10 h-11 pl-3.5 pr-4.5 rounded-full',
          'island flex items-center justify-center gap-2',
          MOBILE_FLOATING_BUTTON_TRANSITION,
          isVisible()
            ? MOBILE_FLOATING_BUTTON_VISIBLE
            : MOBILE_FLOATING_BUTTON_OFFSCREEN_RIGHT
        )}
        disabled={!isVisible()}
        aria-hidden={!isVisible()}
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
  );
}
