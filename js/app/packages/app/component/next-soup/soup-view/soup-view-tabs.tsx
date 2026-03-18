import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import { runCreateAction } from '@app/component/Launcher';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { useSoup } from '@app/component/next-soup/soup-context';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import {
  type ListViewCreateActionId,
  type ListViewCreateOptionId,
  getListViewCreateOptions,
} from '@app/component/list-view-create';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { useUserContext } from '@core/context/user';
import { openFilePicker } from '@core/util/upload';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import {
  batch,
  createMemo,
  For,
  Match,
  type ParentComponent,
  Show,
  Switch,
} from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import { Button } from '@ui/components/Button';

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
      <Match when={isComponentListView('files')}>
        <FilesTabs />
      </Match>
    </Switch>
  );
};

export const SoupViewCreateButton = () => {
  const listView = useCurrentListView();
  const handleFileUpload = useHandleFileUpload();
  const options = createMemo(() => {
    const view = listView();
    if (!view) return [];
    return getListViewCreateOptions(view);
  });

  const primaryOption = createMemo(() => options()[0]);

  const handleSelect = (optionId: ListViewCreateOptionId) => {
    if (optionId === 'import') {
      openFilePicker({ multiple: true }, async (files) => {
        await handleFileUpload(files, false);
      });
      return;
    }

    runCreateAction(optionId as ListViewCreateActionId);
  };

  return (
    <Show when={primaryOption()}>
      {(option) => (
        <Show
          when={options().length > 1}
          fallback={
            <Button
              variant="secondary"
              size="sm"
              class="rounded-xs whitespace-nowrap px-3"
              onClick={() => handleSelect(option().id)}
            >
              {option().label}
            </Button>
          }
        >
          <DropdownMenu placement="bottom-start" gutter={4}>
            <DropdownMenu.Trigger
              as={Button}
              variant="secondary"
              size="sm"
              class="rounded-xs whitespace-nowrap px-3"
            >
              <span>{option().label}</span>
              <ChevronDownIcon class="size-3" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenuContent class="z-action-menu min-w-[160px]">
                <For each={options()}>
                  {(item) => (
                    <MenuItem
                      text={item.label}
                      onClick={() => handleSelect(item.id)}
                    />
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </Show>
      )}
    </Show>
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
          { value: 'shared', label: 'Shared' },
          { value: 'attachments', label: 'Attachments' },
          { value: 'all', label: 'All' },
        ]}
        value={activeTab()}
        defaultValue={VIEW_TAB_PRESETS.files.default}
        onChange={(value) => applyTabPreset('files', value)}
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
      class="size-full text-sm rounded-xs border border-edge-muted relative overflow-hidden"
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
