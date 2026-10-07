/**
 * @file Inline task-list controls for markdown check lists. TaskListNode
 * leaves a non-lexical mount at the top of each check list's `<ul>`; this
 * renderer portals a thin control line into it — the completed count for every
 * check list, plus a hover-revealed filter menu when the list contains tasks.
 *
 * Items that are task mentions resolve their real task properties (status,
 * priority, assignees, due date); plain checkbox items fall back to inline
 * mentions and trailing `!` markers. Filters persist on the list node and dim
 * excluded items in place.
 */
import {
  ListFilterDropdown,
  type ListFilterGroup,
} from '@app/components/view-shell';
import { combine, literal, NIL_UUID } from '@app/features/soup';
import { UserIcon } from '@core/component/UserIcon';
import {
  getTaskAssigneeIds,
  getTaskPriorityOptionId,
  getTaskStatusOptionId,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import Flag from '@phosphor/flag.svg';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useContacts } from '@queries/contacts/contacts';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { cn } from '@ui';
import type { LexicalEditor, NodeKey } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  applyChecklistDom,
  clearChecklistDom,
} from '../../plugins/checklist-controls/applyChecklistDom';
import {
  type ChecklistControlsData,
  type ChecklistMountEntry,
  setTaskListSettings,
} from '../../plugins/checklist-controls/checklistControlsPlugin';
import {
  type ChecklistPlan,
  countActiveFilters,
  DUE_LABELS,
  DUE_ORDER,
  type EffectiveItem,
  effectiveItem,
  type NormalizedSettings,
  normalizeSettings,
  PRIORITY_LABELS,
  PRIORITY_OPTION_ID,
  PRIORITY_ORDER,
  planChecklist,
  STATUS_LABELS,
  STATUS_OPTION_ID,
  STATUS_ORDER,
  type TaskInfo,
} from '../../plugins/checklist-controls/model';

/** Pin every non-document soup target so the query returns tasks only. */
const NON_TASK_TARGETS = {
  calf: literal('id', NIL_UUID),
  callf: literal('CallId', NIL_UUID),
  ccf: literal('id', NIL_UUID),
  cf: literal('cid', NIL_UUID),
  chanf: literal('ChannelId', NIL_UUID),
  cthf: literal('ThreadId', NIL_UUID),
  ef: literal('ThreadId', NIL_UUID),
  fef: literal('id', NIL_UUID),
  pf: literal('pid', NIL_UUID),
};

export function TaskListControlsRenderer(props: {
  editor: LexicalEditor;
  data: ChecklistControlsData;
}) {
  const contacts = useContacts();
  const nameById = createMemo(
    () => new Map(contacts().map((user) => [user.id, user.name ?? user.email]))
  );
  const resolveName = (id: string) => nameById().get(id) ?? 'Unknown';

  const taskIds = createMemo(() => {
    const ids = new Set<string>();
    for (const meta of Object.values(props.data.meta)) {
      for (const item of meta.items) {
        if (item.taskId) ids.add(item.taskId);
      }
    }
    return [...ids].sort();
  });

  // One soup query covers every task the document mentions.
  const tasksQuery = useSoupAstItemsQuery(
    () => ({
      params: {
        expand: true,
        limit: 200,
        sort_method: 'updated_at',
        sort_direction: 'desc',
      },
      body: {
        ...NON_TASK_TARGETS,
        df:
          combine(
            '|',
            taskIds().map((id) => literal('id', id))
          ) ?? literal('id', NIL_UUID),
      },
    }),
    () => ({ enabled: taskIds().length > 0 })
  );

  const taskInfo = createMemo((): Record<string, TaskInfo> => {
    const map: Record<string, TaskInfo> = {};
    if (tasksQuery.isPending) return map;
    for (const entity of tasksQuery.data?.entities ?? []) {
      if (!isTaskEntity(entity)) continue;
      const task = entity as TaskEntityWithProperties;
      map[task.id] = {
        statusOptionId: getTaskStatusOptionId(task) ?? null,
        priorityOptionId: getTaskPriorityOptionId(task) ?? null,
        assigneeIds: getTaskAssigneeIds(task),
        due: getTaskDueDate(task),
      };
    }
    return map;
  });

  const lists = createMemo(() =>
    Object.values(props.data.mounts).filter(
      (entry) => props.data.meta[entry.listKey]
    )
  );

  return (
    <For each={lists()}>
      {(entry) => (
        <TaskListEntryControls
          editor={props.editor}
          data={props.data}
          entry={entry}
          taskInfo={taskInfo()}
          resolveName={resolveName}
        />
      )}
    </For>
  );
}

function getTaskDueDate(task: TaskEntityWithProperties): string | null {
  const property = task.properties?.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.DUE_DATE
  );
  const value = property?.value;
  if (!value || value.type !== 'Date') return null;
  return typeof value.value === 'string' ? value.value : null;
}

function TaskListEntryControls(props: {
  editor: LexicalEditor;
  data: ChecklistControlsData;
  entry: ChecklistMountEntry;
  taskInfo: Record<string, TaskInfo>;
  resolveName: (id: string) => string;
}) {
  const meta = () => props.data.meta[props.entry.listKey];
  const settings = createMemo(() => normalizeSettings(meta()?.settings));
  const hasTasks = createMemo(() =>
    (meta()?.items ?? []).some((item) => item.taskId !== null)
  );
  const items = createMemo(() =>
    (meta()?.items ?? []).map((item) =>
      effectiveItem(
        item,
        item.taskId ? props.taskInfo[item.taskId] : undefined,
        props.resolveName
      )
    )
  );
  const plan = createMemo(() => planChecklist(items(), settings(), new Date()));

  const update = (patch: Partial<NormalizedSettings>) => {
    setTaskListSettings(props.editor, props.entry.listKey, {
      ...settings(),
      ...patch,
    });
  };

  // The filter control reveals on hover over the list (the mount's parent).
  const [hovered, setHovered] = createSignal(false);
  const enter = () => setHovered(true);
  const leave = () => setHovered(false);
  const list = props.entry.bar.parentElement;
  list?.addEventListener('pointerenter', enter);
  list?.addEventListener('pointerleave', leave);
  onCleanup(() => {
    list?.removeEventListener('pointerenter', enter);
    list?.removeEventListener('pointerleave', leave);
  });

  // Write the plan onto the list's DOM, and re-apply after reconciliations.
  let appliedKeys: NodeKey[] = [];
  createEffect(() => {
    props.data.domVersion();
    const p = plan();
    clearChecklistDom(props.editor, appliedKeys);
    applyChecklistDom(props.editor, p);
    appliedKeys = p.rows.map((row) => row.key);
  });
  onCleanup(() => {
    clearChecklistDom(props.editor, appliedKeys);
  });

  return (
    <Portal mount={props.entry.bar}>
      <TaskListBar
        plan={plan}
        settings={settings}
        items={items}
        hasTasks={hasTasks}
        hovered={hovered}
        update={update}
      />
    </Portal>
  );
}

type TaskListFilterGroupId = 'status' | 'priority' | 'assignees' | 'due';

function TaskListBar(props: {
  plan: () => ChecklistPlan;
  settings: () => NormalizedSettings;
  items: () => EffectiveItem[];
  hasTasks: () => boolean;
  hovered: () => boolean;
  update: (patch: Partial<NormalizedSettings>) => void;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const activeFilterCount = () => countActiveFilters(props.settings().filters);
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

  const progressPct = () => {
    const progress = props.plan().progress;
    if (progress.total === 0) return '0%';
    return `${Math.round((progress.done / progress.total) * 100)}%`;
  };

  return (
    <div class="mdtl-bar flex h-6 items-center gap-2 font-sans text-xs text-ink-extra-muted select-none">
      <span class="shrink-0 tabular-nums">
        {props.plan().progress.done}/{props.plan().progress.total}
      </span>
      <div class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-edge-muted">
        <div
          class="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: progressPct() }}
        />
      </div>
      <div class="min-w-4 flex-1" />
      <Show when={props.hasTasks()}>
        <div
          class={cn(
            'relative shrink-0 transition-opacity duration-150',
            filterVisible() ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <ListFilterDropdown
            label="Filter tasks"
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            groups={filterGroups()}
            isSelected={isSelected}
            onSelectionChange={setFilterValue}
            onClear={() =>
              props.update({
                filters: { status: [], priority: [], assignees: [], due: [] },
              })
            }
            class={cn(
              'size-6 shrink-0 p-1',
              activeFilterCount() > 0 ? 'text-accent' : 'text-ink-extra-muted'
            )}
          />
          <Show when={activeFilterCount() > 0}>
            <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-3.5 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
              {activeFilterCount()}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
