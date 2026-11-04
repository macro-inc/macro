import type { ListControlOption } from '@app/components/view-shell/ListDropdowns';
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import { Accordion } from '@kobalte/core/accordion';
import { Key } from '@solid-primitives/keyed';
import { Button, cn, type DialogHandle, Input } from '@ui';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  For,
  getOwner,
  onCleanup,
  Show,
} from 'solid-js';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import { useTaskFilters } from '../filters/use-task-filters';
import { useTasksView } from '../tasks-view-context';
import {
  TaskSavedViewActions,
  TaskSavedViewCreateBanner,
} from '../views/task-saved-views';
import { TaskDueDateRangeDialog } from './task-due-date-range-dialog';

export function TasksFilterDrawer() {
  const { state, setPrimarySort, setState, savedViews, savedViewScope } =
    useTasksView();
  const filters = useTaskFilters();
  const [open, setDrawerOpen] = createSignal(false);
  const [assigneeSearch, setAssigneeSearch] = createSignal('');
  const [expandedSections, setExpandedSections] = createSignal<string[]>([
    filters.groups()[0]?.id ?? 'status',
  ]);
  let assigneeInput: HTMLInputElement | undefined;
  const navigateAssignees = (onSelect: () => void) => {
    batch(() => {
      setAssigneeSearch('');
      onSelect();
    });
    assigneeInput?.focus();
  };
  const setOpen = (value: boolean) => {
    filters
      .groups()
      .find((group) => group.id === 'assignees')
      ?.onOpenChange?.(value);
    if (!value) {
      setAssigneeSearch('');
    }
    setDrawerOpen(value);
  };
  const owner = getOwner();
  let disposed = false;
  let pending:
    | {
        create: () => DialogHandle | undefined;
        scope: ReturnType<typeof savedViewScope>;
      }
    | undefined;
  onCleanup(() => {
    disposed = true;
    pending = undefined;
  });
  const onCreate = (create: () => DialogHandle | undefined) => {
    pending = { create, scope: savedViewScope() };
    setOpen(false);
  };
  const reopen = async (
    dialog: DialogHandle,
    scope: ReturnType<typeof savedViewScope>
  ) => {
    await dialog.closed;
    if (!disposed && scope === savedViewScope()) setOpen(true);
  };
  const afterClose = (present: boolean) => {
    if (present || open()) return;
    const action = pending;
    pending = undefined;
    if (!action) return;
    queueMicrotask(() =>
      queueMicrotask(() => {
        if (disposed || open() || action.scope !== savedViewScope()) return;
        const dialog = action.create();
        if (dialog) fireAndForget(reopen(dialog, action.scope), 'saved-views');
        else setOpen(true);
      })
    );
  };
  const primarySort = () => state.sort[0]?.id ?? 'updated_at';
  const editingSavedView = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' && view.dirty;
  };

  return (
    <>
      <MobileFilterDrawer
        open={open()}
        onOpenChange={setOpen}
        onContentPresentChange={afterClose}
        triggerLabel="Open task filters"
        label="Task list controls"
        activeCount={filters.activeCount()}
        onClear={filters.clear}
        contentOverlay={() => (
          <TaskSavedViewCreateBanner dialogOwner={owner} onCreate={onCreate} />
        )}
        footerEnd={() =>
          editingSavedView() && (
            <TaskSavedViewActions dialogOwner={owner} onCreate={onCreate} />
          )
        }
      >
        <Show
          when={!state.search.trim()}
          fallback={
            <MobileDrawer.Label class="pt-4">
              Search ordering
            </MobileDrawer.Label>
          }
        >
          <MobileDrawer.Label id="task-sort-label" class="pt-4">
            Sort
          </MobileDrawer.Label>
          <MobileDrawer.Section
            role="radiogroup"
            aria-labelledby="task-sort-label"
          >
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
        </Show>

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
          value={expandedSections()}
          onChange={(value) => {
            const wasOpen = expandedSections().includes('assignees');
            const isOpen = value.includes('assignees');
            if (wasOpen !== isOpen) {
              filters
                .groups()
                .find((group) => group.id === 'assignees')
                ?.onOpenChange?.(isOpen);
              if (!isOpen) setAssigneeSearch('');
            }
            setExpandedSections(value);
          }}
        >
          <div class="flex flex-col gap-3">
            <Key each={filters.groups()} by="id">
              {(group) => {
                const activeCount = createMemo(() => {
                  if (group().id === 'assignees')
                    return filters.selectedIds('assignees').length;
                  return group().options.filter(
                    (option) =>
                      option.id !== group().defaultOptionId &&
                      filters.isSelected(group().id, option.id)
                  ).length;
                });
                const visibleOptions = () =>
                  group().options.filter(
                    (option) =>
                      group().id !== 'assignees' ||
                      option.label
                        .toLowerCase()
                        .includes(assigneeSearch().toLowerCase())
                  );
                const renderOptions = (
                  options: Accessor<ListControlOption<string>[]>
                ) => (
                  <>
                    <For each={options()}>
                      {(option) => (
                        <MobileFilterDrawer.Option
                          selectionMode={group().selectionMode ?? 'multiple'}
                          checked={filters.isSelected(group().id, option.id)}
                          onChange={(checked) =>
                            filters.setSelected(group().id, option.id, checked)
                          }
                          icon={option.icon?.()}
                        >
                          {option.content?.() ?? option.label}
                        </MobileFilterDrawer.Option>
                      )}
                    </For>
                    <Show when={group().action}>
                      {(action) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          class={cn('justify-start', action().class)}
                          onPointerDown={(event) => event.preventDefault()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => navigateAssignees(action().onSelect)}
                        >
                          {action().label}
                        </Button>
                      )}
                    </Show>
                    <Show when={group().navigation?.back}>
                      {(back) => (
                        <div class="border-t border-edge-muted p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onPointerDown={(event) => event.preventDefault()}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => navigateAssignees(back().onSelect)}
                          >
                            <ArrowLeftIcon class="size-4" />
                            {back().label}
                          </Button>
                        </div>
                      )}
                    </Show>
                    {group().footer}
                  </>
                );

                return (
                  <MobileFilterDrawer.Section
                    value={group().id}
                    label={group().label}
                    activeCount={activeCount()}
                  >
                    <Show when={group().id === 'assignees'}>
                      <div class="flex items-center gap-2 px-3 pb-2">
                        <Input
                          ref={assigneeInput}
                          class="min-w-0 flex-1"
                          aria-label={group().searchPlaceholder}
                          placeholder={group().searchPlaceholder}
                          value={assigneeSearch()}
                          onInput={(event) =>
                            setAssigneeSearch(event.currentTarget.value)
                          }
                        />
                      </div>
                    </Show>
                    {renderOptions(visibleOptions)}
                  </MobileFilterDrawer.Section>
                );
              }}
            </Key>
          </div>
        </Accordion>
      </MobileFilterDrawer>
      <TaskDueDateRangeDialog
        value={filters.customRange()}
        onChange={filters.setCustomRange}
        onApply={filters.applyCustomRange}
      />
    </>
  );
}
