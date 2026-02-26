import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/filters';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { useSoup } from '@app/component/next-soup/soup-context';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { useUserContext } from '@core/context/user';
import { batch, createMemo, Match, Switch } from 'solid-js';

const useApplyPreset = () => {
  const soup = useSoup();
  const { setQueryFilters } = useSoupView();
  const user = useUserContext();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const applyPreset = (preset: {
    queryFilters: SoupItemsQueryFilters;
    clientFilters: FilterID[];
  }) => {
    batch(() => {
      setQueryFilters(preset.queryFilters);
      soup.filters.set(preset.clientFilters);
    });
  };

  const applyTabPreset = (view: ListView, tabId: string) => {
    const config = VIEW_TAB_PRESETS[view];
    const resolver = config.tabs[tabId];
    if (!resolver) return;

    const resolved = resolver(getPresetContext());
    if (!resolved) return;

    applyPreset(resolved);
  };

  return { applyTabPreset };
};

export const SoupViewTabs = () => {
  const panel = useSplitPanelOrThrow();

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  return (
    <Switch>
      <Match when={isComponentListView('inbox')}>
        <InboxTabs />
      </Match>
      <Match when={isComponentListView('agents')}>
        <AgentsTabs />
      </Match>
      <Match when={isComponentListView('mail')}>
        <MailTabs />
      </Match>
      <Match when={isComponentListView('documents')}>
        <DocumentsTabs />
      </Match>
      <Match when={isComponentListView('tasks')}>
        <TasksTabs />
      </Match>
      <Match when={isComponentListView('channels')}>
        <ChannelsTabs />
      </Match>
      <Match when={isComponentListView('files')}>
        <FilesTabs />
      </Match>
    </Switch>
  );
};

const InboxTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={Object.keys(VIEW_TAB_PRESETS.inbox.tabs)}
        onChange={(value) => applyTabPreset('inbox', value)}
      />
    </div>
  );
};

const AgentsTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'owned', label: 'My agents' },
          { value: 'running', label: 'Running agents' },
          { value: 'shared', label: 'Shared with me' },
        ]}
        onChange={(value) => applyTabPreset('agents', value)}
      />
    </div>
  );
};

const MailTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'important', label: 'Important' },
          { value: 'noise', label: 'Noise' },
          { value: 'drafts', label: 'Drafts' },
          { value: 'sent', label: 'Sent' },
        ]}
        onChange={(value) => applyTabPreset('mail', value)}
      />
    </div>
  );
};

const DocumentsTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'owned', label: 'My documents' },
          { value: 'shared', label: 'Shared with me' },
          { value: 'all', label: 'All' },
        ]}
        onChange={(value) => applyTabPreset('documents', value)}
      />
    </div>
  );
};

const TasksTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'assigned-to-me', label: 'Assigned to me' },
          { value: 'created-by-me', label: 'Created by me' },
          { value: 'all', label: 'All' },
        ]}
        onChange={(value) => applyTabPreset('tasks', value)}
      />
    </div>
  );
};

const ChannelsTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'recent', label: 'Recent' },
          { value: 'people', label: 'People' },
          { value: 'teams', label: 'Teams' },
        ]}
        onChange={(value) => applyTabPreset('channels', value)}
      />
    </div>
  );
};

const FilesTabs = () => {
  const { applyTabPreset } = useApplyPreset();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'owned', label: 'My files' },
          { value: 'shared', label: 'Shared with me' },
          { value: 'all', label: 'All' },
        ]}
        onChange={(value) => applyTabPreset('files', value)}
      />
    </div>
  );
};
