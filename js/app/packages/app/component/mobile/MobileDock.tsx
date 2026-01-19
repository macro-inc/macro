import WideChannel from '@macro-icons/wide/channel.svg';
import SignalIcon from '@macro-icons/wide/signal.svg';
import WideFolder from '@macro-icons/wide/folder.svg';
import WidePlus from '@macro-icons/wide/plus.svg';
import WideTask from '@macro-icons/wide/task.svg';
import { batch, type Component, type JSX } from 'solid-js';
import { setCreateMenuOpen } from '../Launcher';
import { useSplitPanelOrThrow } from '../split-layout/layoutUtils';
import { VIEWCONFIG_BASE } from '../ViewConfig';
import { FOCUS_FILTER_CONFIGS } from '../Soup/utils/filterConfigs';
import {
  isEntityTypeFilterActive,
  isFocusFilterActive,
  sameSet,
} from '../Soup/utils/filterHelpers';

type MobileDockButtonProps = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  label: string;
  onClick: () => void;
  active?: boolean;
};

function MobileDockButton(props: MobileDockButtonProps) {
  return (
    <button
      onClick={props.onClick}
      class="flex flex-col items-center justify-center w-[20%] py-4"
      classList={{
        'text-ink-muted': !props.active,
        'text-ink bg-panel': props.active,
      }}
    >
      <props.icon class="w-6 h-6" />
      <span class="text-xs">{props.label}</span>
    </button>
  );
}

export function MobileDock() {
  const splitContext = useSplitPanelOrThrow();
  const { selectedView, setViewDataStore, viewsDataStore } =
    splitContext.soupContext;

  const splitContent = () => splitContext.handle.content();
  const view = () => viewsDataStore[selectedView()];
  const filters = () => view()?.filters ?? VIEWCONFIG_BASE.filters;
  const typeFilter = () => filters().typeFilter ?? [];
  const channelCategoryFilter = () => filters().channelCategoryFilter ?? [];
  const focusFilters = () => filters().focusFilters ?? [];

  const splitIsUnifiedList = () =>
    splitContent().type === 'component' && splitContent().id === 'unified-list';

  const ensureUnifiedList = () => {
    if (splitIsUnifiedList()) return;
    splitContext.handle.replace({
      next: { type: 'component', id: 'unified-list' },
    });
  };

  const isInboxActive = () =>
    isFocusFilterActive(focusFilters(), 'signal') && splitIsUnifiedList();
  const isPeopleTeamsActive = () =>
    isEntityTypeFilterActive(typeFilter(), 'channel') &&
    sameSet(channelCategoryFilter(), ['people', 'groups']) &&
    splitIsUnifiedList();
  const isTasksActive = () =>
    isEntityTypeFilterActive(typeFilter(), 'task') && splitIsUnifiedList();
  const isAllActive = () =>
    !isInboxActive() &&
    !isPeopleTeamsActive() &&
    !isTasksActive() &&
    splitIsUnifiedList();

  const setFocusFilter = (target: 'signal' | 'noise' | 'none') => {
    const config =
      target === 'none'
        ? FOCUS_FILTER_CONFIGS.none
        : FOCUS_FILTER_CONFIGS[target];
    const viewId = selectedView();
    setViewDataStore(viewId, 'filters', 'focusFilters', [
      ...config.focusFilters,
    ]);
    setViewDataStore(
      viewId,
      'filters',
      'notificationFilter',
      config.notificationFilter
    );
    setViewDataStore(
      viewId,
      'display',
      'unrollNotifications',
      config.unrollNotifications
    );
  };

  const setTypeFilters = ({
    type,
    channelCategories = [],
  }: {
    type: Array<'channel' | 'chat' | 'document' | 'email' | 'project' | 'task'>;
    channelCategories?: Array<'people' | 'groups'>;
  }) => {
    const viewId = selectedView();
    setViewDataStore(viewId, 'filters', 'typeFilter', type);
    setViewDataStore(viewId, 'filters', 'documentTypeFilter', []);
    setViewDataStore(viewId, 'filters', 'channelCategoryFilter', [
      ...channelCategories,
    ]);
  };

  const clearSearchFilters = () => {
    const viewId = selectedView();
    batch(() => {
      setTypeFilters({ type: [], channelCategories: [] });
      setFocusFilter('none');
      setViewDataStore(viewId, 'filters', 'unreadOnly', false);
    });
  };

  return (
    <div class="flex flex-row justify-between bg-linear-to-t from-page to-panel border-t border-edge-muted">
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
            setFocusFilter('signal');
            setTypeFilters({ type: [] });
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
            setFocusFilter('none');
            setTypeFilters({
              type: ['channel'],
              channelCategories: ['people', 'groups'],
            });
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
            setFocusFilter('none');
            setTypeFilters({ type: ['task'] });
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
