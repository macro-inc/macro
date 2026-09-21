import {
  ListFilterDropdown,
  type ListFilterGroup,
  MobileFilterDrawer,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { Accordion } from '@kobalte/core/accordion';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import { Dropdown } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { selectedHomeTypes, setHomeTypeSelected } from '../core/type-selection';
import { INBOX_FILTER_GROUPS } from '../inbox-facets';
import { useInboxView } from '../inbox-view-context';

const FILTER_ICONS = new Map<string, () => JSX.Element>([
  [
    'documents',
    () => (
      <EntityIcon
        targetType="md"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'tasks',
    () => (
      <EntityIcon
        targetType="task"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'email',
    () => (
      <EntityIcon
        targetType="email"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'channels',
    () => (
      <EntityIcon
        targetType="channel"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'chats',
    () => (
      <EntityIcon
        targetType="chat"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'agents',
    () => (
      <EntityIcon
        targetType="agent"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'projects',
    () => (
      <EntityIcon
        targetType="project"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  [
    'github',
    () => (
      <EntityIcon
        targetType="githubPullRequest"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
  ['reminders', () => <BellSimpleIcon class="size-3.5 text-ink-muted" />],
  [
    'calendar',
    () => (
      <EntityIcon
        targetType="calendar"
        size="xs"
        theme="monochrome"
        class="text-ink-muted"
      />
    ),
  ],
]);

const FILTER_GROUPS = INBOX_FILTER_GROUPS.map((group) => ({
  ...group,
  options: group.options.map((option) => ({
    ...option,
    icon: FILTER_ICONS.get(option.id),
  })),
}));
const TYPE_IDS = FILTER_GROUPS.flatMap((group) =>
  group.id === 'type' ? group.options.map((option) => option.id) : []
);

function useInboxFilters() {
  const { state, setFacets } = useInboxView();

  const isSelected = (groupId: string, optionId: string) => {
    const selectedIds = state.facets[groupId] ?? [];
    if (groupId === 'read' && optionId === 'all')
      return selectedIds.length === 0;
    return groupId === 'type'
      ? selectedHomeTypes(selectedIds, TYPE_IDS).includes(optionId)
      : selectedIds.includes(optionId);
  };

  const setSelected = (
    groupId: string,
    optionId: string,
    selected: boolean
  ) => {
    if (groupId === 'read') {
      setFacets({
        ...state.facets,
        read: optionId === 'all' ? [] : [optionId],
      });
      return;
    }
    setFacets({
      ...state.facets,
      [groupId]: setHomeTypeSelected(
        state.facets[groupId],
        TYPE_IDS,
        optionId,
        selected
      ),
    });
  };

  const activeCount = () =>
    TYPE_IDS.length -
    selectedHomeTypes(state.facets.type, TYPE_IDS).length +
    (state.facets.read?.length ? 1 : 0);

  return {
    activeCount,
    clear: () => setFacets({}),
    isGroupActive: (groupId: string) =>
      groupId === 'type'
        ? selectedHomeTypes(state.facets.type, TYPE_IDS).length <
          TYPE_IDS.length
        : (state.facets[groupId]?.length ?? 0) > 0,
    isSelected,
    setSelected,
  };
}

function FilterCountBadge(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-3 translate-x-1/2 items-center justify-center rounded-full bg-panel text-[9px] font-medium leading-none text-ink-muted">
        {props.count}
      </span>
    </Show>
  );
}

const HOME_FILTER_GROUPS: ListFilterGroup<string, string>[] = [
  {
    id: 'read',
    label: 'Status',
    selectionMode: 'single',
    defaultOptionId: 'all',
    options: [
      { id: 'unread', label: 'Unread' },
      { id: 'read', label: 'Read' },
      { id: 'all', label: 'All' },
    ],
  },
  ...FILTER_GROUPS.map((group) => ({ ...group, label: 'Type' })),
];

export function InboxFilterDropdown() {
  const filters = useInboxFilters();
  const panel = useSplitPanelOrThrow();
  const [open, setOpen] = createSignal(false);
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter Home',
      run: () => {
        setOpen(true);
      },
    },
  });

  return (
    <div class="relative ml-auto shrink-0">
      <ListFilterDropdown
        label="Filter Home"
        customTrigger={
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            square
            label="Filter Home"
          >
            <FilterIcon />
          </Dropdown.Trigger>
        }
        groups={HOME_FILTER_GROUPS}
        open={open()}
        onOpenChange={setOpen}
        isSelected={filters.isSelected}
        isGroupActive={filters.isGroupActive}
        onSelectionChange={filters.setSelected}
        onClear={filters.clear}
        clearLabel="Reset filters"
      />
      <FilterCountBadge count={filters.activeCount()} />
    </div>
  );
}

export function InboxFilterDrawer() {
  const filters = useInboxFilters();

  return (
    <MobileFilterDrawer
      triggerLabel="Filter Home"
      label="Home filters"
      activeCount={filters.activeCount()}
      onClear={filters.clear}
    >
      <Accordion multiple collapsible defaultValue={['read', 'type']}>
        <div class="flex flex-col">
          <For each={HOME_FILTER_GROUPS}>
            {(group) => {
              const activeCount = createMemo(
                () =>
                  group.options.filter((option) =>
                    group.id === 'type'
                      ? !filters.isSelected(group.id, option.id)
                      : option.id !== 'all' &&
                        filters.isSelected(group.id, option.id)
                  ).length
              );

              return (
                <MobileFilterDrawer.Section
                  value={group.id}
                  label={group.label}
                  activeCount={activeCount()}
                  class="mb-3"
                >
                  <div
                    role={
                      group.selectionMode === 'single' ? 'radiogroup' : 'group'
                    }
                    aria-label={group.label}
                  >
                    <For each={group.options}>
                      {(option) => (
                        <MobileFilterDrawer.Option
                          selectionMode={group.selectionMode}
                          checked={filters.isSelected(group.id, option.id)}
                          onChange={(checked) =>
                            filters.setSelected(group.id, option.id, checked)
                          }
                          icon={option.icon?.()}
                        >
                          {option.label}
                        </MobileFilterDrawer.Option>
                      )}
                    </For>
                  </div>
                </MobileFilterDrawer.Section>
              );
            }}
          </For>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}
