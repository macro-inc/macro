import {
  type ListFilterGroup,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SortIcon from '@phosphor/sort-ascending.svg';
import GroupIcon from '@phosphor/stack.svg';
import TagIcon from '@phosphor/tag.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { TagDot } from '@property/tags/TagDot';
import { useTagSets } from '@property/tags/tag-sets-context';
import { useContacts } from '@queries/contacts/contacts';
import { Button, cn, Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '../filters/task-facets';
import { useTasksView } from '../tasks-view-context';

type TaskFilterGroupId =
  | 'status'
  | 'priority'
  | 'assignees'
  | 'created-by'
  | 'tags';

export function TasksControls(props: { tagsOnly?: boolean }) {
  const [tagsExpanded, setTagsExpanded] = createSignal(true);
  const panel = useSplitPanelOrThrow();
  const { state, setFacets, setPrimarySort, setState } = useTasksView();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const tagSets = useTagSets();
  let filterControl: HTMLDivElement | undefined;
  let sortControl: HTMLDivElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => !props.tagsOnly && panel.isPanelActive(),
    filter: props.tagsOnly
      ? undefined
      : {
          description: 'Filter tasks',
          run: () => {
            const trigger = filterControl?.querySelector('button');
            trigger?.click();

            return trigger !== null && trigger !== undefined;
          },
        },
    sort: props.tagsOnly
      ? undefined
      : {
          description: 'Sort tasks',
          run: () => {
            const trigger = sortControl?.querySelector('button');
            trigger?.click();

            return trigger !== null && trigger !== undefined;
          },
        },
  });

  const primarySort = () => state.sort[0]?.id ?? 'updated_at';
  const activeFilterCount = createMemo(() =>
    Object.values(state.facets).reduce(
      (count, optionIds) => count + optionIds.length,
      0
    )
  );

  const peopleOptions = createMemo(() => {
    const people = [...contacts()];
    const me = currentUserId();
    if (me && !people.some((person) => person.id === me)) {
      people.unshift({ id: me, email: '', name: idToDisplayName(me) });
    }

    return people.map((person) => ({
      id: person.id,
      label:
        person.id === me
          ? person.name
            ? `${person.name} (me)`
            : 'Me'
          : person.name || person.id,
      icon: () => (
        <UserIcon
          id={person.id}
          size="sm"
          class="size-3.5"
          suppressClick
          showTooltip={false}
        />
      ),
    }));
  });

  const filterGroups = createMemo(
    (): ListFilterGroup<TaskFilterGroupId, string>[] => [
      {
        id: 'status',
        label: 'Status',
        options: TASK_STATUS_OPTIONS.map((option) => ({
          ...option,
          icon: () => (
            <PropertyValueIcon
              optionId={option.propertyOptionId}
              class="size-3.5"
            />
          ),
        })),
      },
      {
        id: 'priority',
        label: 'Priority',
        options: TASK_PRIORITY_OPTIONS.map((option) => ({
          ...option,
          icon: () => (
            <PropertyValueIcon
              optionId={option.propertyOptionId}
              class="size-3.5"
            />
          ),
        })),
      },
      {
        id: 'assignees',
        label: 'Assigned',
        options: peopleOptions(),
      },
      {
        id: 'created-by',
        label: 'Created by',
        options: peopleOptions(),
      },
      {
        id: 'tags',
        label: 'Tags',
        options: tagSets().flatMap((set) =>
          set.options.map((option) => ({
            id: option.id,
            label:
              option.value.type === 'string' ? option.value.value : option.id,
            icon: () => <TagDot color={option.color ?? undefined} />,
          }))
        ),
      },
    ]
  );

  const change = (groupId: string, optionId: string, selected: boolean) => {
    const update = selected ? addUnique(optionId) : removeValue(optionId);
    setFacets({ ...state.facets, [groupId]: update(state.facets[groupId]) });
  };

  return (
    <Show
      when={!props.tagsOnly}
      fallback={
        <section aria-label="Tags" class="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            class="mb-1 flex h-7 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-ink-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            aria-expanded={tagsExpanded()}
            onClick={() => setTagsExpanded(!tagsExpanded())}
          >
            <CaretDownIcon
              class={cn('size-3', !tagsExpanded() && '-rotate-90')}
            />
            Tags
          </button>
          <Show when={tagsExpanded()}>
            <div class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
              <For
                each={
                  filterGroups().find((group) => group.id === 'tags')?.options
                }
              >
                {(tag) => (
                  <Button
                    variant="ghost"
                    class={cn(
                      'h-9 shrink-0 justify-start gap-3 rounded-xl px-3 font-normal',
                      state.facets.tags?.includes(tag.id) &&
                        'bg-active text-ink'
                    )}
                    aria-pressed={state.facets.tags?.includes(tag.id) ?? false}
                    onClick={() =>
                      change(
                        'tags',
                        tag.id,
                        !state.facets.tags?.includes(tag.id)
                      )
                    }
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      {tag.icon?.()}
                    </span>
                    <span class="truncate">{tag.label}</span>
                  </Button>
                )}
              </For>
            </div>
          </Show>
        </section>
      }
    >
      <div
        class="relative flex min-h-11 shrink-0 flex-wrap items-center gap-2 px-4 py-2"
        aria-label="Task filters"
      >
        <div
          ref={(element) => (filterControl = element)}
          class="flex flex-wrap items-center gap-2"
        >
          <For
            each={['status', 'assignees', 'created-by', 'priority'] as const}
          >
            {(id) => (
              <For each={filterGroups().filter((group) => group.id === id)}>
                {(group) => (
                  <TaskFacetDropdown
                    group={group}
                    selected={state.facets[id] ?? []}
                    onChange={(optionId, selected) =>
                      change(id, optionId, selected)
                    }
                    onClear={() => setFacets({ ...state.facets, [id]: [] })}
                  />
                )}
              </For>
            )}
          </For>
          <div class="hidden @max-[720px]/view-shell:block">
            <For each={filterGroups().filter((group) => group.id === 'tags')}>
              {(group) => (
                <TaskFacetDropdown
                  group={group}
                  selected={state.facets.tags ?? []}
                  onChange={(id, selected) => change('tags', id, selected)}
                  onClear={() => setFacets({ ...state.facets, tags: [] })}
                />
              )}
            </For>
          </div>
          <Show when={activeFilterCount() > 0}>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs text-ink-muted"
              onClick={() => setFacets({})}
            >
              Clear filters
            </Button>
          </Show>
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <Dropdown placement="bottom-end">
            <Dropdown.Trigger
              variant="ghost"
              size="sm"
              class="h-7 gap-1.5 rounded-lg bg-ink/4 px-2 text-xs"
              aria-label="Group tasks"
            >
              <GroupIcon class="size-3.5" /> Group
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.RadioGroup
                value={state.groupBy}
                onChange={(value) =>
                  setState('groupBy', value as typeof state.groupBy)
                }
              >
                <For each={TASK_GROUP_OPTIONS}>
                  {(option) => (
                    <Dropdown.RadioItem value={option.id} closeOnSelect>
                      <span class="flex-1">{option.label}</span>
                      <Dropdown.ItemIndicator>
                        <CheckIcon class="size-3.5" />
                      </Dropdown.ItemIndicator>
                    </Dropdown.RadioItem>
                  )}
                </For>
              </Dropdown.RadioGroup>
            </Dropdown.Content>
          </Dropdown>
          <div ref={(element) => (sortControl = element)}>
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                variant="ghost"
                size="sm"
                class="h-7 gap-1.5 rounded-lg bg-ink/4 px-2 text-xs"
                aria-label="Sort tasks"
              >
                <SortIcon class="size-3.5" /> Sort
              </Dropdown.Trigger>
              <Dropdown.Content>
                <Dropdown.RadioGroup
                  value={primarySort()}
                  onChange={(value) =>
                    setPrimarySort(value as ReturnType<typeof primarySort>)
                  }
                >
                  <For each={TASK_SORT_OPTIONS}>
                    {(option) => (
                      <Dropdown.RadioItem value={option.id} closeOnSelect>
                        <span class="flex-1">{option.label}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Content>
            </Dropdown>
          </div>
        </div>
      </div>
    </Show>
  );
}

function TaskFacetDropdown(props: {
  group: ListFilterGroup<TaskFilterGroupId, string>;
  selected: string[];
  onChange: (id: string, selected: boolean) => void;
  onClear: () => void;
  sidebar?: boolean;
}) {
  const [search, setSearch] = createSignal('');
  const options = () =>
    props.group.options.filter((option) =>
      option.label.toLowerCase().includes(search().toLowerCase())
    );
  const selectionLabel = () =>
    props.selected.length === 1
      ? (props.group.options.find((option) => option.id === props.selected[0])
          ?.label ?? '1 selected')
      : `${props.selected.length} selected`;
  return (
    <Dropdown placement="bottom-start" onOpenChange={() => setSearch('')}>
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        aria-label={`Filter by ${props.group.label.toLowerCase()}`}
        class={cn(
          'h-7 gap-1.5 rounded-lg bg-ink/4 px-2 text-xs',
          props.selected.length > 0 && 'bg-active text-ink',
          props.sidebar && 'h-10 w-full justify-start rounded-xl'
        )}
      >
        <Show when={props.sidebar}>
          <TagIcon class="size-4 shrink-0 text-ink-muted" />
        </Show>
        <span
          class={cn(
            'truncate',
            props.sidebar ? 'flex-1 text-left' : 'max-w-40'
          )}
        >
          {props.group.label}
          <Show when={props.selected.length > 0}>: {selectionLabel()}</Show>
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 rounded-xl">
        <input
          aria-label={`Search ${props.group.label.toLowerCase()}`}
          placeholder={`Search ${props.group.label.toLowerCase()}…`}
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Tab')
              event.stopPropagation();
          }}
          class="mb-1 h-9 w-full rounded-lg border border-edge-muted bg-transparent px-3 text-sm outline-none focus:border-edge"
        />
        <Dropdown.Group class="max-h-64 overflow-y-auto">
          <For each={options()}>
            {(option) => (
              <Dropdown.CheckboxItem
                checked={props.selected.includes(option.id)}
                closeOnSelect={false}
                onChange={(selected) => props.onChange(option.id, selected)}
              >
                <span class="flex min-w-0 items-center gap-2">
                  <Show when={option.icon}>
                    <span class="shrink-0">{option.icon?.()}</span>
                  </Show>
                  <span class="truncate">{option.label}</span>
                </span>
              </Dropdown.CheckboxItem>
            )}
          </For>
          <Show when={options().length === 0}>
            <div class="px-3 py-3 text-sm text-ink-muted">No matches</div>
          </Show>
        </Dropdown.Group>
        <Show when={props.selected.length > 0}>
          <Dropdown.Group>
            <Dropdown.Item onSelect={props.onClear}>
              Clear {props.group.label.toLowerCase()}
            </Dropdown.Item>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
