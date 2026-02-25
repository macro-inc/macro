import WideChannel from '@macro-icons/wide/channel.svg';
import SignalIcon from '@macro-icons/wide/signal.svg';
import WideFolder from '@macro-icons/wide/folder.svg';
import WidePlus from '@macro-icons/wide/plus.svg';
import WideTask from '@macro-icons/wide/task.svg';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { batch, type Component, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { setCreateMenuOpen } from '../Launcher';
import { useSplitPanelOrThrow } from '../split-layout/layoutUtils';
import { useSoup } from '@app/component/next-soup/soup-context';
import type { FilterID } from '@app/component/next-soup/filters/filters';

type MobileDockButtonProps = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  label: string;
  onClick: () => void;
  active?: boolean;
};

function MobileDockButton(props: MobileDockButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        impactFeedback('light');
        props.onClick();
      }}
      class={cn(
        'flex flex-col items-center justify-center w-[20%] pt-3',
        props.active && 'text-accent'
      )}
    >
      <props.icon class="w-6 h-6" />
      <span class="text-xs">{props.label}</span>
    </button>
  );
}

export function MobileDock() {
  const splitContext = useSplitPanelOrThrow();
  const soup = useSoup();

  const splitContent = () => splitContext.handle.content();

  const splitIsUnifiedList = () => {
    const id = splitContent().id;
    const type = splitContent().type;

    return type === 'component' && id === 'unified-list';
  };

  const ensureUnifiedList = () => {
    if (splitIsUnifiedList()) return;
    splitContext.handle.replace({
      next: { type: 'component', id: 'unified-list' },
    });
  };

  const isInboxActive = () =>
    soup.filters.isActive('signal') && splitIsUnifiedList();
  const isPeopleTeamsActive = () =>
    soup.filters.isActive('channels') && splitIsUnifiedList();
  const isTasksActive = () =>
    soup.filters.isActive('task') && splitIsUnifiedList();
  const isAllActive = () =>
    !isInboxActive() &&
    !isPeopleTeamsActive() &&
    !isTasksActive() &&
    splitIsUnifiedList();

  const activateFilter = (filter: FilterID) => {
    soup.filters.activate(filter);
  };

  const toggleSignalFilter = (value: boolean) => {
    // If we're going to be removing the signal filter,
    // we should replace it with the explicit-noise filter
    if (!value) {
      activateFilter('explicit-noise');
      soup.filters.deactivate('not-done');
    } else {
      activateFilter('signal');
      activateFilter('not-done');
    }
  };

  const clearSearchFilters = () => {
    soup.filters.clear();
  };

  return (
    <div class="flex flex-row justify-between bg-page border-t border-edge-muted">
      <MobileDockButton
        icon={WideFolder}
        label="All"
        active={isAllActive()}
        onClick={() => {
          ensureUnifiedList();
          clearSearchFilters();
        }}
      />
      <MobileDockButton
        icon={SignalIcon}
        label="Inbox"
        active={isInboxActive()}
        onClick={() => {
          ensureUnifiedList();
          batch(() => {
            clearSearchFilters();
            toggleSignalFilter(true);
          });
        }}
      />
      <MobileDockButton
        icon={WideChannel}
        label="People"
        active={isPeopleTeamsActive()}
        onClick={() => {
          ensureUnifiedList();
          batch(() => {
            toggleSignalFilter(false);
            activateFilter('channels');
          });
        }}
      />
      <MobileDockButton
        icon={WideTask}
        label="Tasks"
        active={isTasksActive()}
        onClick={() => {
          ensureUnifiedList();
          batch(() => {
            toggleSignalFilter(false);
            activateFilter('task');
          });
        }}
      />
      <MobileDockButton
        icon={WidePlus}
        label="Create"
        onClick={() => {
          setCreateMenuOpen(true);
        }}
      />
    </div>
  );
}
