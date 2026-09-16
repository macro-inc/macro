import { MobileFilterDrawer } from '@app/components/view-shell';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { EntityIcon } from '@core/component/EntityIcon';
import { Accordion } from '@kobalte/core/accordion';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import { Dropdown, ToggleSwitch } from '@ui';
import { createMemo, For, type JSX, Show } from 'solid-js';
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
    return groupId === 'type'
      ? selectedHomeTypes(selectedIds, TYPE_IDS).includes(optionId)
      : selectedIds.includes(optionId);
  };

  const setSelected = (
    groupId: string,
    optionId: string,
    selected: boolean
  ) => {
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

  const unreadOnly = () => state.facets.read?.includes('unread') ?? false;
  const setUnreadOnly = (checked: boolean) =>
    setFacets({ ...state.facets, read: checked ? ['unread'] : [] });

  const activeCount = () =>
    TYPE_IDS.length -
    selectedHomeTypes(state.facets.type, TYPE_IDS).length +
    (unreadOnly() ? 1 : 0);

  return {
    unreadOnly,
    setUnreadOnly,
    activeCount,
    clear: () => setFacets({}),
    isSelected,
    setSelected,
  };
}

function FilterCountBadge(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="pointer-events-none absolute -top-0.5 right-0 flex size-3 translate-x-1/2 items-center justify-center rounded-full bg-panel text-[9px] font-medium leading-none text-ink-muted">
        {props.count}
      </span>
    </Show>
  );
}

export function InboxFilterDropdown() {
  const filters = useInboxFilters();

  return (
    <div class="relative ml-auto shrink-0">
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger variant="ghost" size="sm" square label="Filter Home">
          <FilterIcon />
        </Dropdown.Trigger>
        <Dropdown.Content class="max-h-[min(36rem,calc(100dvh-5rem))] w-56 overflow-y-auto">
          <Dropdown.Group>
            <Dropdown.Item
              role="menuitemcheckbox"
              aria-checked={filters.unreadOnly()}
              closeOnSelect={false}
              onSelect={() => filters.setUnreadOnly(!filters.unreadOnly())}
            >
              <span class="flex-1">Unread only</span>
              <span aria-hidden="true" inert class="pointer-events-none flex">
                <ToggleSwitch checked={filters.unreadOnly()} size="xs" />
              </span>
            </Dropdown.Item>
          </Dropdown.Group>
          <For each={FILTER_GROUPS}>
            {(group) => (
              <Dropdown.Group>
                <Dropdown.GroupLabel>{group.label}</Dropdown.GroupLabel>
                <For each={group.options}>
                  {(option) => (
                    <Dropdown.CheckboxItem
                      checked={filters.isSelected(group.id, option.id)}
                      closeOnSelect={false}
                      onChange={(selected) =>
                        filters.setSelected(group.id, option.id, selected)
                      }
                    >
                      {option.icon?.()}
                      <span>{option.label}</span>
                    </Dropdown.CheckboxItem>
                  )}
                </For>
              </Dropdown.Group>
            )}
          </For>
          <Dropdown.Group>
            <Dropdown.Item onSelect={filters.clear}>
              Reset filters
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>

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
      <MobileDrawer.Item
        role="switch"
        aria-checked={filters.unreadOnly()}
        onClick={() => filters.setUnreadOnly(!filters.unreadOnly())}
      >
        <span class="flex-1">Unread only</span>
        <span aria-hidden="true" inert class="pointer-events-none flex">
          <ToggleSwitch checked={filters.unreadOnly()} />
        </span>
      </MobileDrawer.Item>

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
                    (option) => !filters.isSelected(group.id, option.id)
                  ).length
              );

              return (
                <MobileFilterDrawer.Section
                  value={group.id}
                  label={group.label}
                  activeCount={activeCount()}
                  class="mb-3"
                >
                  <div role="group" aria-label={group.label}>
                    <For each={group.options}>
                      {(option) => (
                        <MobileFilterDrawer.Option
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
