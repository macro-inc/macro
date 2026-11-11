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
import { combine, literal, NIL_UUID } from '@app/features/soup';
import {
  getTaskAssigneeIds,
  getTaskDueDate,
  getTaskPriorityOptionId,
  getTaskStatusOptionId,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity';
import { useContacts } from '@queries/contacts/contacts';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { LexicalEditor, NodeKey } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
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
  countActiveFilters,
  effectiveItem,
  type NormalizedSettings,
  normalizeSettings,
  planChecklist,
  type TaskInfo,
} from '../../plugins/checklist-controls/model';
import { TaskListBar } from './TaskListBar';

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
        due: getTaskDueDate(task) ?? null,
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
        progress={() => plan().progress}
        progressPercentage={() => {
          const progress = plan().progress;
          if (progress.total === 0) return '0%';
          return `${Math.round((progress.done / progress.total) * 100)}%`;
        }}
        filterCount={() => countActiveFilters(settings().filters)}
        settings={settings}
        items={items}
        hasTasks={hasTasks}
        hovered={hovered}
        update={update}
      />
    </Portal>
  );
}
