import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Accordion } from '@kobalte/core/accordion';
import type { DialogHandle } from '@ui';
import { createMemo, createSignal, For, getOwner, onCleanup } from 'solid-js';
import { useTaskFilters } from '../filters/use-task-filters';
import { useTasksView } from '../tasks-view-context';
import {
  TaskSavedViewActions,
  TaskSavedViewCreateBanner,
} from '../views/task-saved-views';
import { TaskDueDateRangeDialog } from './task-due-date-range-dialog';

export function TasksFilterDrawer() {
  const { savedViews, savedViewScope } = useTasksView();
  const filters = useTaskFilters();
  const [open, setOpen] = createSignal(false);
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
        label={t('viewMenus.filters')}
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
                    group.options.filter(
                      (option) =>
                        option.id !== group.defaultOptionId &&
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
                          selectionMode={group.selectionMode ?? 'multiple'}
                          checked={filters.isSelected(group.id, option.id)}
                          onChange={(checked) =>
                            filters.setSelected(group.id, option.id, checked)
                          }
                          icon={option.icon?.()}
                        >
                          {option.content?.() ?? option.label}
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
      <TaskDueDateRangeDialog
        value={filters.customRange()}
        onChange={filters.setCustomRange}
        onApply={filters.applyCustomRange}
      />
    </>
  );
}
