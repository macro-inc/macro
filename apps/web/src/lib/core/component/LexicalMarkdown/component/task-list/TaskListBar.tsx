/** Shared checklist controls markup; callers supply their actual planned facts. */
import {
  ListFilterDropdown,
  type ListFilterGroup,
} from '@app/components/view-shell';
import { UserIcon } from '@core/component/UserIcon';
import CalendarBlank from '@icon/system/regular/calendar-blank.svg';
import Flag from '@icon/system/regular/flag.svg';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { cn } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import {
  type ChecklistAssignee,
  DUE_LABELS,
  DUE_ORDER,
  type NormalizedSettings,
  PRIORITY_LABELS,
  PRIORITY_OPTION_ID,
  PRIORITY_ORDER,
  STATUS_LABELS,
  STATUS_OPTION_ID,
  STATUS_ORDER,
} from '../../plugins/checklist-controls/model';

type TaskListFilterGroupId = 'status' | 'priority' | 'assignees' | 'due';

export function TaskListBar(props: {
  progress: () => { done: number; total: number };
  progressPercentage: () => string;
  filterCount: () => number;
  settings: () => NormalizedSettings;
  items: () => ReadonlyArray<{ assignees: ReadonlyArray<ChecklistAssignee> }>;
  hasTasks: () => boolean;
  hovered: () => boolean;
  update: (patch: Partial<NormalizedSettings>) => void;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const activeFilterCount = () => props.filterCount();
  const filterVisible = () =>
    props.hovered() || menuOpen() || activeFilterCount() > 0;

  const setFilterValue = (
    facet: keyof NormalizedSettings['filters'],
    value: string,
    selected: boolean
  ) => {
    const filters = props.settings().filters;
    const current = filters[facet];
    props.update({
      filters: {
        ...filters,
        [facet]: selected
          ? [...current, value]
          : current.filter((v) => v !== value),
      },
    });
  };

  const assigneeOptions = createMemo(() => {
    const seen = new Map<string, string>();
    for (const item of props.items()) {
      for (const assignee of item.assignees) {
        if (!seen.has(assignee.id)) seen.set(assignee.id, assignee.name);
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const filterGroups = createMemo(
    (): ListFilterGroup<TaskListFilterGroupId, string>[] => [
      {
        id: 'status',
        label: 'Status',
        options: STATUS_ORDER.map((status) => ({
          id: status,
          label: STATUS_LABELS[status],
          icon: () => (
            <PropertyValueIcon
              optionId={STATUS_OPTION_ID[status]}
              class="size-3.5"
            />
          ),
        })),
      },
      {
        id: 'priority',
        label: 'Priority',
        options: PRIORITY_ORDER.map((priority) => ({
          id: priority,
          label: PRIORITY_LABELS[priority],
          icon: () =>
            priority === 'none' ? (
              <Flag class="size-3.5 text-ink-extra-muted" />
            ) : (
              <PropertyValueIcon
                optionId={PRIORITY_OPTION_ID[priority]}
                class="size-3.5"
              />
            ),
        })),
      },
      ...(assigneeOptions().length > 0
        ? [
            {
              id: 'assignees' as const,
              label: 'Assignee',
              searchPlaceholder: 'Search assignees...',
              options: [
                ...assigneeOptions().map((option) => ({
                  id: option.id,
                  label: option.name,
                  icon: () => (
                    <UserIcon
                      id={option.id}
                      name={option.name}
                      size="sm"
                      class="size-3.5"
                      suppressClick
                      showTooltip={false}
                    />
                  ),
                })),
                { id: 'unassigned', label: 'Unassigned' },
              ],
            },
          ]
        : []),
      {
        id: 'due',
        label: 'Due date',
        options: DUE_ORDER.map((due) => ({
          id: due,
          label: DUE_LABELS[due],
          icon: () => <CalendarBlank class="size-3.5 text-ink-extra-muted" />,
        })),
      },
    ]
  );

  const isSelected = (groupId: TaskListFilterGroupId, optionId: string) =>
    props.settings().filters[groupId].includes(optionId);

  return (
    <div class="mdtl-bar flex h-6 items-center gap-2 font-sans text-xs text-ink-extra-muted select-none">
      <span class="shrink-0 tabular-nums">
        {props.progress().done}/{props.progress().total}
      </span>
      <div class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-edge-muted">
        <div
          class="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: props.progressPercentage() }}
        />
      </div>
      <Show when={props.hasTasks()}>
        <div
          class={cn(
            'shrink-0 transition-opacity duration-150',
            filterVisible() ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <ListFilterDropdown
            label="Filter tasks"
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            groups={filterGroups()}
            isSelected={isSelected}
            selectedIds={(group) => props.settings().filters[group]}
            onSelectionChange={setFilterValue}
            onGroupSelectionChange={(group, ids) =>
              props.update({
                filters: { ...props.settings().filters, [group]: [...ids] },
              })
            }
            onClear={() =>
              props.update({
                filters: { status: [], priority: [], assignees: [], due: [] },
              })
            }
            size={activeFilterCount() > 0 ? 'xs' : undefined}
            activeCount={activeFilterCount()}
            class={cn(
              'shrink-0',
              activeFilterCount() > 0
                ? 'text-accent'
                : 'size-6 p-1 text-ink-extra-muted'
            )}
          />
        </div>
      </Show>
    </div>
  );
}
