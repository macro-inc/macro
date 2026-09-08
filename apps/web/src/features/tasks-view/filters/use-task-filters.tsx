import type { ListFilterGroup } from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { TagDot } from '@property/tags/TagDot';
import { useTagSets } from '@property/tags/tag-sets-context';
import { useContacts } from '@queries/contacts/contacts';
import { createMemo } from 'solid-js';
import { useTasksView } from '../tasks-view-context';
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from './task-facets';

export type TaskFilterGroupId =
  | 'status'
  | 'priority'
  | 'assignees'
  | 'created-by'
  | 'tags';

export function useTaskFilters() {
  const { state, setFacets } = useTasksView();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const tagSets = useTagSets();

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
        label: 'Assignees',
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

  return {
    activeCount,
    clear: () => setFacets({}),
    groups,
    isSelected,
    setSelected,
  };
}
