import {
  ListFilterDropdown,
  MobileFilterDrawer,
} from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { EntityIcon } from '@core/component/EntityIcon';
import { Accordion } from '@kobalte/core/accordion';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { INBOX_FILTER_GROUPS } from '../inbox-facets';
import { useInboxView } from '../inbox-view-context';

const FILTER_ICONS = new Map<string, () => JSX.Element>([
  ['documents', () => <EntityIcon targetType="md" size="xs" />],
  ['tasks', () => <EntityIcon targetType="task" size="xs" />],
  ['email', () => <EntityIcon targetType="email" size="xs" />],
  ['channels', () => <EntityIcon targetType="channel" size="xs" />],
  ['agents', () => <EntityIcon targetType="chat" size="xs" />],
  ['projects', () => <EntityIcon targetType="project" size="xs" />],
  ['github', () => <EntityIcon targetType="githubPullRequest" size="xs" />],
  ['reminders', () => <BellSimpleIcon class="size-3.5 text-ink-muted" />],
  ['calendar', () => <EntityIcon targetType="calendar" size="xs" />],
]);

const FILTER_GROUPS = INBOX_FILTER_GROUPS.map((group) => ({
  ...group,
  options: group.options.map((option) => ({
    ...option,
    icon: FILTER_ICONS.get(option.id),
  })),
}));

function useInboxFilters() {
  const { state, setFacets } = useInboxView();

  const isSelected = (groupId: string, optionId: string) => {
    const selectedIds = state.facets[groupId] ?? [];
    if (groupId === 'read' && optionId === 'all') {
      return selectedIds.length === 0;
    }

    return selectedIds.includes(optionId);
  };

  const setSelected = (
    groupId: string,
    optionId: string,
    selected: boolean
  ) => {
    if (groupId === 'read') {
      if (!selected) return;

      setFacets({
        ...state.facets,
        [groupId]: optionId === 'all' ? [] : [optionId],
      });
      return;
    }

    const update = selected ? addUnique(optionId) : removeValue(optionId);
    setFacets({
      ...state.facets,
      [groupId]: update(state.facets[groupId]),
    });
  };

  const activeCount = () =>
    Object.values(state.facets).reduce(
      (count, optionIds) => count + optionIds.length,
      0
    );

  return {
    activeCount,
    clear: () => setFacets({}),
    isSelected,
    setSelected,
  };
}

function FilterCountBadge(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="absolute -top-0.5 right-0 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
        {props.count}
      </span>
    </Show>
  );
}

export function InboxFilterDropdown() {
  const filters = useInboxFilters();

  return (
    <div class="relative ml-auto shrink-0">
      <ListFilterDropdown
        groups={FILTER_GROUPS}
        isSelected={filters.isSelected}
        onSelectionChange={filters.setSelected}
        onClear={filters.clear}
        label="Filter Inbox"
      />

      <FilterCountBadge count={filters.activeCount()} />
    </div>
  );
}

export function InboxFilterDrawer() {
  const filters = useInboxFilters();

  return (
    <MobileFilterDrawer
      triggerLabel="Open Inbox filters"
      label="Inbox filters"
      activeCount={filters.activeCount()}
      onClear={filters.clear}
    >
      <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>

      <Accordion
        multiple
        collapsible
        defaultValue={[FILTER_GROUPS[0]?.id ?? 'type']}
      >
        <div class="flex flex-col">
          <For each={FILTER_GROUPS}>
            {(group) => {
              const activeCount = createMemo(
                () =>
                  group.options.filter(
                    (option) =>
                      option.id !== group.defaultOptionId &&
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
