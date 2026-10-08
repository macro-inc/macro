import type {
  AiFilterOutcome,
  ListFilterGroup,
} from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { useContacts } from '@queries/contacts/contacts';
import { batch, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import { requestAiTaskFilterPlan } from '../queries/ai-task-filter-plan';
import { useTasksView } from '../tasks-view-context';
import type { AiTaskFilterCatalog } from './ai-task-filter';
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from './task-facets';

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
  | 'tags';

export function useTaskFilters() {
  const { state, setFacets, setState } = useTasksView();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const tagGroup = useTagFilterGroup();

  const peopleOptions = createMemo(() => {
    const me = currentUserId();
    const people = [...contacts()].sort(
      (a, b) => Number(b.id === me) - Number(a.id === me)
    );
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

  const groups = createMemo(
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
        label: 'Assignee',
        searchPlaceholder: 'Search assignees...',
        options: peopleOptions(),
      },
      {
        id: 'created-by',
        label: 'Created by',
        searchPlaceholder: 'Search creators...',
        options: peopleOptions(),
      },
      ...(tagGroup().options.length > 0 ? [tagGroup()] : []),
    ]
  );

  const isSelected = (groupId: TaskFilterGroupId, optionId: string) =>
    (state.facets[groupId] ?? []).includes(optionId);

  const setSelected = (
    groupId: TaskFilterGroupId,
    optionId: string,
    selected: boolean
  ) => {
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

  const aiCatalog = (): AiTaskFilterCatalog => ({
    people: peopleOptions().map(({ id, label }) => ({ id, label })),
    tags: tagGroup().options.map(({ id, label }) => ({ id, label })),
  });

  /** Replaces the selection with filters resolved from a plain-English request. */
  const applyDescription = async (query: string): Promise<AiFilterOutcome> => {
    const result = await requestAiTaskFilterPlan(query, aiCatalog());
    if (result.isErr()) {
      return {
        status: 'error',
        message: match(result.error)
          .with({ code: 'UNAVAILABLE' }, () => AI_FILTER_UNAVAILABLE_MESSAGE)
          .with({ code: 'UNREADABLE' }, () => AI_FILTER_UNREADABLE_MESSAGE)
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
    clear: () => setFacets({}),
    groups,
    isSelected,
    setSelected,
  };
}
