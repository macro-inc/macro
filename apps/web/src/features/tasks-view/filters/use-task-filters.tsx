import type {
  AiFilterOutcome,
  ListFilterGroup,
} from '@app/components/view-shell';
import { NO_ASSIGNEE } from '@app/features/next-soup/filters';
import {
  AssigneePickerStatus,
  useAssigneePicker,
} from '@app/features/soup/assignee-picker';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { beginInteraction } from '@app/observability/flow';
import { useUserId } from '@core/context/user';
import { useContactFilterLabels } from '@core/user/use-contact-filter-options';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { batch, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import type { TaskDateRangeDraft } from '../components/task-due-date-range-dialog';
import {
  isTaskDueDateBucket,
  TASK_DUE_DATE_BUCKETS,
} from '../core/task-due-date';
import { useAiTaskFilterPlan } from '../queries/ai-task-filter-plan';
import { useTasksView } from '../tasks-view-context';
import type { AiTaskFilterCatalog } from './ai-task-filter';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_VIEWER,
} from './task-facets';
import { taskPeopleSource, taskViewerOption } from './task-people-options';
import {
  taskProjectSource,
  useTaskProjectLabels,
} from './task-project-options';

const AI_FILTER_STALE_MESSAGE =
  'The account or filters changed. Try the request again.';
const AI_FILTER_UNAVAILABLE_MESSAGE =
  'AI filtering is unavailable right now. Try again in a moment.';
const AI_FILTER_UNREADABLE_MESSAGE =
  'The AI reply could not be read. Try rephrasing your request.';
const AI_FILTER_NOTHING_MATCHED_MESSAGE =
  'Nothing in that request maps to a filter. Try naming a status, priority, person, or tag.';

export type TaskFilterGroupId =
  | 'status'
  | 'priority'
  | 'assignees'
  | 'created-by'
  | 'project'
  | 'tags'
  | 'due_date';

export function useTaskFilters() {
  const {
    state,
    setFacets,
    setState,
    savedViews,
    savedViewScope,
    showProjectFilter,
    projectsEnabled,
  } = useTasksView();
  const currentUserId = useUserId();
  const tagGroup = useTagFilterGroup();
  const [customRange, setCustomRange] = createSignal<TaskDateRangeDraft>();
  const assigneePicker = useAssigneePicker(
    () => (state.facets.assignees ?? []).filter((id) => id !== TASK_VIEWER),
    () => true
  );
  const selectedAssigneesAtViewEntry = createMemo(
    on(assigneePicker.selectedIdsAtViewEntry, () => [
      ...(state.facets.assignees ?? []),
    ])
  );

  const selectedPeople = createMemo(() =>
    [
      ...new Set([
        ...(state.facets.assignees ?? []),
        ...(state.facets['created-by'] ?? []),
      ]),
    ].filter((id) => id !== TASK_VIEWER)
  );
  const labels = useContactFilterLabels(selectedPeople);
  const createPeopleSource = taskPeopleSource(!!savedViews);
  const projectOptions = useTaskProjectLabels(
    () => state.facets.project ?? [],
    projectsEnabled
  );
  const createProjectSource = taskProjectSource(projectsEnabled);
  const peopleOptions = (group: 'assignees' | 'created-by') =>
    (state.facets[group] ?? []).flatMap((id) => {
      const option =
        id === TASK_VIEWER
          ? taskViewerOption(currentUserId())
          : labels().get(id);
      return option ? [option] : [];
    });
  const requestPlan = useAiTaskFilterPlan();
  const account = useQueryAccount();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  // Returning to identical filters after an intervening edit is still a new input.
  const inputScope = createMemo(() => ({
    facets: JSON.stringify(state.facets),
    search: state.search,
    navigation: savedViewScope(),
    account: account(),
  }));

  const assigneeOptions = createMemo(() => [
    ...(savedViews || state.facets.assignees?.includes(TASK_VIEWER)
      ? [taskViewerOption(currentUserId())]
      : []),
    ...assigneePicker.options().filter((option) => option.id !== NO_ASSIGNEE),
  ]);

  const withUnavailable = (
    id: TaskFilterGroupId,
    options: ListFilterGroup<TaskFilterGroupId, string>['options']
  ) => [
    ...options,
    ...(state.facets[id] ?? [])
      .filter((selected) => !options.some((option) => option.id === selected))
      .map((selected) => ({
        id: selected,
        label: `Unavailable ${id === 'tags' ? 'tag' : 'option'}`,
      })),
  ];

  const groups = createMemo(
    (): ListFilterGroup<TaskFilterGroupId, string>[] => [
      {
        id: 'status',
        label: 'Status',
        options: withUnavailable(
          'status',
          TASK_STATUS_OPTIONS.map((option) => ({
            ...option,
            icon: () => (
              <PropertyValueIcon
                optionId={option.propertyOptionId}
                class="size-3.5"
              />
            ),
          }))
        ),
      },
      {
        id: 'priority',
        label: 'Priority',
        options: withUnavailable(
          'priority',
          TASK_PRIORITY_OPTIONS.map((option) => ({
            ...option,
            icon: () => (
              <PropertyValueIcon
                optionId={option.propertyOptionId}
                class="size-3.5"
              />
            ),
          }))
        ),
      },
      {
        id: 'due_date',
        label: 'Due date',
        selectionMode: 'single',
        defaultOptionId: 'any',
        options: [
          { id: 'any', label: 'Any due date' },
          ...TASK_DUE_DATE_BUCKETS,
          { id: 'has_due_date', label: 'Has due date' },
          {
            id: 'range',
            label:
              state.dueDate?.type === 'range'
                ? `Custom range (${state.dueDate.start ?? 'Any'} – ${state.dueDate.end ?? 'Any'})`
                : 'Custom range…',
          },
        ],
      },
      {
        id: 'assignees',
        label: 'Assignee',
        searchPlaceholder: assigneePicker.placeholder(),
        options: assigneeOptions(),
        footer: <AssigneePickerStatus picker={assigneePicker} />,
        onOpenChange: assigneePicker.onOpenChange,
      },
      {
        id: 'created-by',
        label: 'Created by',
        searchPlaceholder: 'Search creators...',
        options: peopleOptions('created-by'),
        createSource: createPeopleSource,
      },
      ...(showProjectFilter()
        ? [
            {
              id: 'project' as const,
              label: 'Project',
              searchPlaceholder: 'Search projects...',
              options: projectOptions(),
              createSource: createProjectSource,
            },
          ]
        : []),
      ...(tagGroup().options.length > 0 || (state.facets.tags?.length ?? 0) > 0
        ? [
            {
              ...tagGroup(),
              options: withUnavailable('tags', tagGroup().options),
            },
          ]
        : []),
    ]
  );

  const isSelected = (groupId: TaskFilterGroupId, optionId: string) =>
    groupId === 'due_date'
      ? (state.dueDate?.type ?? 'any') === optionId
      : (state.facets[groupId] ?? []).includes(optionId);

  const setSelected = (
    groupId: TaskFilterGroupId,
    optionId: string,
    selected: boolean
  ) => {
    if (groupId === 'due_date') {
      if (optionId === 'range') {
        const current = state.dueDate;
        setCustomRange({
          start: current?.type === 'range' ? (current.start ?? '') : '',
          end: current?.type === 'range' ? (current.end ?? '') : '',
        });
      } else if (!selected || optionId === 'any') {
        setState('dueDate', undefined);
      } else if (isTaskDueDateBucket(optionId) || optionId === 'has_due_date') {
        setState('dueDate', { type: optionId });
      }
      return;
    }
    const update = selected ? addUnique(optionId) : removeValue(optionId);
    const interaction = beginInteraction('tasks.filter', {
      attributes: { 'task.filter.group': groupId },
    });
    try {
      setFacets({
        ...state.facets,
        [groupId]: update(state.facets[groupId]),
      });
    } finally {
      interaction.end();
    }
  };

  const activeCount = () =>
    Object.values(state.facets).reduce(
      (count, optionIds) => count + optionIds.length,
      state.dueDate ? 1 : 0
    );

  const aiCatalog = (): AiTaskFilterCatalog => ({
    viewer: savedViews ? TASK_VIEWER : (currentUserId() ?? ''),
    tags: tagGroup().options.map(({ id, label }) => ({ id, label })),
  });

  /** Replaces the selection with filters resolved from a plain-English request. */
  const applyDescription = async (query: string): Promise<AiFilterOutcome> => {
    const scope = inputScope();
    const result = await requestPlan(
      query,
      aiCatalog(),
      () => !disposed && inputScope() === scope
    );
    if (disposed || inputScope() !== scope)
      return { status: 'error', message: AI_FILTER_STALE_MESSAGE };
    if (result.isErr()) {
      return {
        status: 'error',
        message: match(result.error)
          .with({ code: 'UNAVAILABLE' }, () => AI_FILTER_UNAVAILABLE_MESSAGE)
          .with({ code: 'UNREADABLE' }, () => AI_FILTER_UNREADABLE_MESSAGE)
          .with(
            { code: 'UNRESOLVED_PEOPLE' },
            () =>
              'A person is unknown, ambiguous, or unavailable. Use a full name or email address.'
          )
          .with({ code: 'STALE' }, () => AI_FILTER_STALE_MESSAGE)
          .with(
            { code: 'NO_FILTERS' },
            ({ unresolved }) => unresolved ?? AI_FILTER_NOTHING_MATCHED_MESSAGE
          )
          .exhaustive(),
      };
    }

    const plan = result.value;
    batch(() => {
      setFacets(plan.facets);
      if (plan.search) setState('search', plan.search);
    });
    return { status: 'applied', note: plan.unresolved };
  };

  return {
    activeCount,
    applyDescription,
    clear: () =>
      batch(() => {
        setFacets({});
        setState('dueDate', undefined);
      }),
    customRange,
    setCustomRange,
    applyCustomRange: () => {
      const range = customRange();
      if (
        !range ||
        !(range.start || range.end) ||
        (range.start && range.end && range.start > range.end)
      )
        return;
      setState('dueDate', {
        type: 'range',
        start: range.start || undefined,
        end: range.end || undefined,
      });
      setCustomRange(undefined);
    },
    groups,
    selectedAssigneesAtViewEntry,
    isSelected,
    selectedIds: (groupId: TaskFilterGroupId) => state.facets[groupId] ?? [],
    setSelected,
  };
}
