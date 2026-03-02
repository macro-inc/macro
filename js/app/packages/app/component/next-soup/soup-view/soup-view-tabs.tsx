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
      soup.filters.set({ and: preset.clientFilters });
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
        list={[
          { value: 'signal', label: 'Signal' },
          { value: 'noise', label: 'Noise' },
          { value: 'all', label: 'All' },
        ]}
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
          { value: 'owned', label: 'Owned' },
          { value: 'running', label: 'Running' },
          { value: 'shared', label: 'Shared' },
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
          { value: 'owned', label: 'Owned' },
          { value: 'shared', label: 'Shared' },
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
          { value: 'assigned-to-me', label: 'Assigned' },
          { value: 'created-by-me', label: 'Created' },
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
          { value: 'owned', label: 'Owned' },
          { value: 'shared', label: 'Shared' },
          { value: 'all', label: 'All' },
        ]}
        onChange={(value) => applyTabPreset('files', value)}
      />
    </div>
  );
};

export const SegmentedControl: ParentComponent<
  {
    list: { value: string; label: string }[];
    value?: string;
  } & SegmentedControlRootProps
> = (props) => {
  const onChange = (newValue: string) => {
    props.onChange?.(newValue);
  };

  return (
    <KSegmentedControl
      class="size-full text-sm border border-edge-muted rounded-sm p-0.5"
      defaultValue={props.list[0]?.value}
      onChange={onChange}
      disabled={props.disabled}
    >
      <div class="relative" role="presentation">
        <KSegmentedControl.Indicator class="absolute rounded bg-accent/15 border border-accent/30 transition-all ease-out" />
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
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                  <KSegmentedControl.ItemLabel class="relative text-ink-muted size-full px-3 py-1 text-xs font-medium data-[checked]:text-accent transition-colors block">
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
