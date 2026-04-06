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
import { Tabs, type TabItem } from '@core/component/Tabs';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Switch,
} from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import { hapticImpact } from '@core/mobile/haptics';
import { cn } from '@ui/utils/classname';

/** Views that have tab definitions. Shared between VIEW_TAB_LISTS and VIEW_TAB_PRESETS. */
export type TabbedListView = Extract<
  ListView,
  'inbox' | 'agents' | 'mail' | 'documents' | 'tasks' | 'channels' | 'folders'
>;

/** Tab definitions for each list view. */
export const VIEW_TAB_LISTS: Record<TabbedListView, TabItem[]> = {
  inbox: [
    { value: 'signal', label: 'Signal' },
    { value: 'noise', label: 'Noise' },
    { value: 'all', label: 'All' },
  ],
  agents: [
    { value: 'owned', label: 'Owned' },
    { value: 'running', label: 'Running' },
    { value: 'shared', label: 'Shared' },
  ],
  mail: [
    { value: 'important', label: 'Signal' },
    { value: 'noise', label: 'Noise' },
    { value: 'sent', label: 'Sent' },
    { value: 'drafts', label: 'Drafts' },
    { value: 'shared', label: 'Shared' },
    { value: 'all', label: 'All' },
  ],
  documents: [
    { value: 'owned', label: 'Owned' },
    { value: 'shared', label: 'Shared' },
    { value: 'attachments', label: 'Attachments' },
    { value: 'all', label: 'All' },
  ],
  tasks: [
    { value: 'assigned-to-me', label: 'Assigned' },
    { value: 'created-by-me', label: 'Created' },
    { value: 'all', label: 'All' },
  ],
  channels: [
    { value: 'recent', label: 'Recent' },
    { value: 'people', label: 'People' },
    { value: 'teams', label: 'Teams' },
  ],
  folders: [
    { value: 'owned', label: 'Owned' },
    { value: 'all', label: 'All' },
  ],
};

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

  const applyTabPreset = (view: ListView, tabId: string): boolean => {
    const config = VIEW_TAB_PRESETS[view];
    if (!config) return false;
    const resolver = config.tabs[tabId];
    if (!resolver) return false;

    const resolved = resolver(getPresetContext());
    if (!resolved) return false;

    setActiveTab(tabId);
    applyPreset(resolved);
    return true;
  };

  return { applyTabPreset };
};

export const SoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <Switch>
      <For each={Object.keys(VIEW_TAB_LISTS) as TabbedListView[]}>
        {(v) => (
          <Match when={listView() === v}>
            <ViewTabs view={v} />
          </Match>
        )}
      </For>
    </Switch>
  );
};

const ViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();
  const list = () => VIEW_TAB_LISTS[props.view];

  return (
    <Tabs
      list={list()}
      value={activeTab()}
      defaultValue={VIEW_TAB_PRESETS[props.view].default}
      onChange={(value) => applyTabPreset(props.view, value)}
    />
  );
};

/** Compact dropdown variant of tabs, used when the header is too narrow for the full segmented control. */
export const CollapsedSoupViewTabs = () => {
  const listView = useCurrentListView();
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  const list = createMemo(() => {
    const view = listView();
    if (!view || !(view in VIEW_TAB_LISTS)) return [];
    return VIEW_TAB_LISTS[view as TabbedListView];
  });

  const activeLabel = createMemo(() => {
    const tab = activeTab();
    return list().find((item) => item.value === tab)?.label ?? list()[0]?.label;
  });

  return (
    <DropdownMenu placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger class="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs border border-edge-muted hover:bg-ink/6 transition-colors">
        <span class="truncate">{activeLabel()}</span>
        <ChevronDownIcon class="size-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-sm p-1">
          <For each={list()}>
            {(item) => (
              <DropdownMenu.Item
                class="w-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default rounded-md"
                classList={{
                  'font-semibold': activeTab() === item.value,
                }}
                onSelect={() => {
                  const view = listView();
                  if (view) applyTabPreset(view, item.value);
                }}
              >
                {item.label}
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
};

export const MobileSoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <Switch>
      <For
        each={Object.keys(VIEW_TAB_LISTS) as (keyof typeof VIEW_TAB_LISTS)[]}
      >
        {(v) => (
          <Match when={listView() === v}>
            <MobileViewTabs view={v} />
          </Match>
        )}
      </For>
    </Switch>
  );
};

const MobileViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  let scrollRef!: HTMLDivElement;
  let spacerRef!: HTMLDivElement;
  const itemRefs: HTMLDivElement[] = [];
  const textRefs: HTMLSpanElement[] = [];

  const tabs = () => VIEW_TAB_LISTS[props.view];

  const [scrollActiveId, setScrollActiveId] = createSignal<string>();
  const [activeWidth, setActiveWidth] = createSignal(0);

  createEffect(
    on(scrollActiveId, (id) => {
      const idx = tabs().findIndex((t) => t.value === id);
      const el = textRefs[idx];
      if (el) setActiveWidth(el.offsetWidth);
    })
  );

  const updateActiveFromScroll = () => {
    const scrollLeft = scrollRef.scrollLeft;
    let closest: HTMLDivElement | null = null;
    let closestDist = Infinity;
    for (const el of itemRefs) {
      const dist = Math.abs(el.offsetLeft - scrollLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closest = el;
      }
    }
    const id = closest?.dataset.tabId;
    if (id && scrollActiveId() !== id) {
      hapticImpact('light');
      setScrollActiveId(id);
    }
  };

  const updateSpacer = () => {
    const last = itemRefs[itemRefs.length - 1];
    if (last) {
      spacerRef.style.width = `${scrollRef.clientWidth - last.offsetWidth}px`;
    }
  };

  onMount(() => {
    updateSpacer();
    const tab = activeTab();
    const idx = tabs().findIndex((t) => t.value === tab);
    const startIdx = idx >= 0 ? idx : 0;
    scrollRef.scrollLeft = itemRefs[startIdx]?.offsetLeft ?? 0;
    setScrollActiveId(tabs()[startIdx]?.value);
  });

  const handleTouchEnd = () => {
    const id = scrollActiveId();
    if (id) {
      applyTabPreset(props.view, id);
    }
  };

  const handleItemClick = (tabValue: string, idx: number) => {
    const el = itemRefs[idx];
    if (el) scrollRef.scrollTo({ left: el.offsetLeft, behavior: 'smooth' });
    hapticImpact('light');
    applyTabPreset(props.view, tabValue);
  };

  return (
    <div class="relative bg-panel border-t border-edge-muted [--tab-padding-l:1rem]">
      <div
        ref={scrollRef}
        class="flex flex-row overflow-x-scroll scrollbar-hidden"
        style="scroll-snap-type: x mandatory;"
        onScroll={updateActiveFromScroll}
        onTouchEnd={handleTouchEnd}
      >
        <For each={tabs()}>
          {(tab, i) => (
            <div
              ref={(el) => {
                itemRefs[i()] = el;
              }}
              data-tab-id={tab.value}
              class={cn(
                'flex-shrink-0 flex items-center pl-(--tab-padding-l) pt-3 pb-3 min-h-11 text-sm cursor-pointer',
                scrollActiveId() === tab.value ? 'text-ink' : 'text-ink/60'
              )}
              style="scroll-snap-align: start;"
              onClick={() => handleItemClick(tab.value, i())}
            >
              <span
                ref={(el) => {
                  textRefs[i()] = el;
                }}
              >
                {tab.label}
              </span>
            </div>
          )}
        </For>
        <div ref={spacerRef} class="flex-shrink-0" />
      </div>
      <div
        class="absolute top-0 left-(--tab-padding-l) h-[3px] bg-accent transition-[width] duration-150 pointer-events-none"
        style={{ width: `${activeWidth()}px` }}
      />
    </div>
  );
};
