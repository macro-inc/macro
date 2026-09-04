import {
  ListFilterDropdown,
  type ListFilterGroup,
  ListGroupDropdown,
  ListSortDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { TagDot } from '@property/tags/TagDot';
import { useTagSets } from '@property/tags/tag-sets-context';
import { useContacts } from '@queries/contacts/contacts';
import { createMemo, Show } from 'solid-js';
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

export function TasksControls() {
  const panel = useSplitPanelOrThrow();
  const { state, setFacets, setPrimarySort, setState } = useTasksView();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const tagSets = useTagSets();
  let filterControl: HTMLDivElement | undefined;
  let sortControl: HTMLDivElement | undefined;

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter tasks',
      run: () => {
        const trigger = filterControl?.querySelector('button');
        trigger?.click();

        return trigger !== null && trigger !== undefined;
      },
    },
    sort: {
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

  return (
    <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 @max-[720px]/view-shell:gap-1">
      <div ref={(element) => (sortControl = element)}>
        <ListSortDropdown
          label="Sort tasks"
          value={primarySort()}
          options={TASK_SORT_OPTIONS}
          onChange={setPrimarySort}
        />
      </div>
      <ListGroupDropdown
        label="Group tasks"
        value={state.groupBy}
        options={TASK_GROUP_OPTIONS}
        onChange={(groupBy) => setState('groupBy', groupBy)}
      />
      <div
        ref={(element) => (filterControl = element)}
        class="relative shrink-0"
      >
        <ListFilterDropdown
          label="Filter tasks"
          groups={filterGroups()}
          isSelected={(groupId, optionId) =>
            (state.facets[groupId] ?? []).includes(optionId)
          }
          onSelectionChange={(groupId, optionId, selected) => {
            const update = selected
              ? addUnique(optionId)
              : removeValue(optionId);

            setFacets({
              ...state.facets,
              [groupId]: update(state.facets[groupId]),
            });
          }}
          onClear={() => setFacets({})}
        />
        <Show when={activeFilterCount() > 0}>
          <span class="absolute -top-0.5 right-0 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {activeFilterCount()}
          </span>
        </Show>
      </div>
      <PreviewButton iconOnly class="rounded-lg" />
    </div>
  );
}
