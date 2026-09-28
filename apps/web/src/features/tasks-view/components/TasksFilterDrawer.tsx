import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import { createMemo, For } from 'solid-js';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import { useTaskFilters } from '../filters/use-task-filters';
import { useTasksView } from '../tasks-view-context';

export function TasksFilterDrawer() {
  const { state, setPrimarySort, setState } = useTasksView();
  const filters = useTaskFilters();
  const primarySort = () => state.sort[0]?.id ?? 'updated_at';

  return (
    <MobileFilterDrawer
      triggerLabel="Open task filters"
      label="Task list controls"
      activeCount={filters.activeCount()}
      onClear={filters.clear}
    >
      <MobileDrawer.Label id="task-sort-label" class="pt-4">
        Sort
      </MobileDrawer.Label>
      <MobileDrawer.Section role="radiogroup" aria-labelledby="task-sort-label">
        <For each={TASK_SORT_OPTIONS}>
          {(option) => {
            const selected = () => primarySort() === option.id;

            return (
              <MobileFilterDrawer.Option
                selectionMode="single"
                checked={selected()}
                onChange={() => setPrimarySort(option.id)}
              >
                {option.label}
              </MobileFilterDrawer.Option>
            );
          }}
        </For>
      </MobileDrawer.Section>

      <MobileDrawer.Label id="task-group-label" class="pt-4">
        Group
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby="task-group-label"
      >
        <For each={TASK_GROUP_OPTIONS}>
          {(option) => {
            const selected = () => state.groupBy === option.id;

            return (
              <MobileFilterDrawer.Option
                selectionMode="single"
                checked={selected()}
                onChange={() => setState('groupBy', option.id)}
              >
                {option.label}
              </MobileFilterDrawer.Option>
            );
          }}
        </For>
      </MobileDrawer.Section>

      <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
      <Accordion
        multiple
        collapsible
        defaultValue={[filters.groups()[0]?.id ?? 'status']}
      >
        <div class="flex flex-col gap-3">
          <For each={filters.groups()}>
            {(group) => {
              const activeCount = createMemo(
                () =>
                  group.options.filter((option) =>
                    filters.isSelected(group.id, option.id)
                  ).length
              );

              return (
                <MobileFilterDrawer.Section
                  value={group.id}
                  label={group.label}
                  activeCount={activeCount()}
                >
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
                </MobileFilterDrawer.Section>
              );
            }}
          </For>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}
