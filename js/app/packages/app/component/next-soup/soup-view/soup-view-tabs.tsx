import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { useSoup } from '@app/component/next-soup/soup-context';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { useUserContext } from '@core/context/user';
import {
  batch,
  createMemo,
  For,
  Match,
  type ParentComponent,
  Switch,
} from 'solid-js';
import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';

const useCurrentListView = () => {
  const panel = useSplitPanelOrThrow();

  return createMemo<ListView | undefined>(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return isListViewID(content.id) ? content.id : undefined;
  });
};

export const useApplyPreset = () => {
  const soup = useSoup();
  const { setQueryFilters, setActiveTab } = useSoupView();
  const user = useUserContext();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const applyPreset = (preset: {
    queryFilters: SoupItemsQueryFilters;
    clientFilters: { and?: FilterID[]; or?: FilterID[] };
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

    setActiveTab(tabId);
    applyPreset(resolved);
  };

  return { applyTabPreset };
};

export const SoupViewTabs = () => {
  const listView = useCurrentListView();

  const isComponentListView = (view: ListView) => {
    return listView() === view;
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
      <Match when={isComponentListView('folders')}>
        <FilesTabs />
      </Match>
    </Switch>
  );
};

const InboxTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'signal', label: 'Signal' },
          { value: 'noise', label: 'Noise' },
          { value: 'all', label: 'All' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.inbox.default}
        onChange={(value) => applyTabPreset('inbox', value)}
      />
    </div>
  );
};

const AgentsTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'owned', label: 'Owned' },
          { value: 'running', label: 'Running' },
          { value: 'shared', label: 'Shared' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.agents.default}
        onChange={(value) => applyTabPreset('agents', value)}
      />
    </div>
  );
};

const MailTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'important', label: 'Important' },
          { value: 'noise', label: 'Noise' },
          { value: 'drafts', label: 'Drafts' },
          { value: 'sent', label: 'Sent' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.mail.default}
        onChange={(value) => applyTabPreset('mail', value)}
      />
    </div>
  );
};

const DocumentsTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'owned', label: 'Owned' },
          { value: 'shared', label: 'Shared' },
          { value: 'attachments', label: 'Attachments' },
          { value: 'all', label: 'All' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.documents.default}
        onChange={(value) => applyTabPreset('documents', value)}
      />
    </div>
  );
};

const TasksTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'assigned-to-me', label: 'Assigned' },
          { value: 'created-by-me', label: 'Created' },
          { value: 'all', label: 'All' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.tasks.default}
        onChange={(value) => applyTabPreset('tasks', value)}
      />
    </div>
  );
};

const ChannelsTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'recent', label: 'Recent' },
          { value: 'people', label: 'People' },
          { value: 'teams', label: 'Teams' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.channels.default}
        onChange={(value) => applyTabPreset('channels', value)}
      />
    </div>
  );
};

const FilesTabs = () => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <div>
      <SegmentedControl
        list={[
          { value: 'owned', label: 'Owned' },
          { value: 'all', label: 'All' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.folders.default}
        onChange={(value) => applyTabPreset('folders', value)}
      />
    </div>
  );
};

export const SegmentedControl: ParentComponent<
  {
    list: { value: string; label: string }[];
    value?: string;
    defaultValue?: string;
  } & Omit<SegmentedControlRootProps, 'defaultValue'>
> = (props) => {
  const onChange = (newValue: string) => {
    props.onChange?.(newValue);
  };

  return (
    <KSegmentedControl
      class="h-full text-sm rounded-xs border border-edge-muted relative overflow-hidden"
      value={props.value}
      defaultValue={props.defaultValue ?? props.list[0]?.value}
      onChange={onChange}
      disabled={props.disabled}
    >
      <div class="relative" role="presentation">
        <div class="flex" role="presentation">
          <For each={props.list}>
            {(item) => {
              const itemValue = () =>
                typeof item === 'object' ? item.value : item;
              const itemLabel = () =>
                typeof item === 'object' ? item.label : item;
              return (
                <KSegmentedControl.Item
                  value={itemValue()}
                  disabled={props.disabled}
                  class="border-r border-edge-muted last:border-r-0"
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                  <KSegmentedControl.ItemLabel class="relative text-ink-muted/70 size-full px-2.5 py-1 text-xs font-medium data-[checked]:text-ink data-[checked]:bg-edge/50 hover:text-ink hover:bg-ink/6 data-[checked]:hover:bg-edge/60 transition-colors duration-150 block">
                    {itemLabel()}
                  </KSegmentedControl.ItemLabel>
                </KSegmentedControl.Item>
              );
            }}
          </For>
        </div>
      </div>
    </KSegmentedControl>
  );
};
