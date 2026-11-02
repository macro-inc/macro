import { VIEW_LAYOUT_OPTIONS } from '@app/components/view-shell/ListDropdowns';
import {
  ListViewMenu,
  type ListViewMenuProps,
} from '@app/components/view-shell/ListViewMenu';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import { TASK_BOARD_GROUP_OPTIONS } from '../core/task-board';
import { useTasksView } from '../tasks-view-context';
import type { TaskGroupBy, TaskSortId } from '../types';

export function TasksViewMenu(
  props: Pick<
    ListViewMenuProps<TaskGroupBy, TaskSortId>,
    'open' | 'onOpenChange' | 'triggerRef'
  >
) {
  const { state, setPrimarySort, setState, projectsEnabled, ganttEnabled } =
    useTasksView();
  const groupOptions = () => {
    if (state.layout !== 'board') return TASK_GROUP_OPTIONS;
    return TASK_GROUP_OPTIONS.filter(
      (option) =>
        TASK_BOARD_GROUP_OPTIONS.some(
          (boardOption) => boardOption.id === option.id
        ) &&
        (option.id !== 'project' || projectsEnabled())
    );
  };

  return (
    <ListViewMenu
      {...props}
      layout={
        isTouchDevice()
          ? undefined
          : {
              value: state.layout,
              options: VIEW_LAYOUT_OPTIONS.filter(
                (option) => option.id !== 'gantt' || ganttEnabled()
              ),
              onChange: (layout) => setState('layout', layout),
            }
      }
      group={{
        value: state.groupBy,
        options: groupOptions(),
        onChange: (groupBy) => setState('groupBy', groupBy),
      }}
      sort={{
        value: state.sort[0]?.id ?? 'updated_at',
        options: TASK_SORT_OPTIONS,
        onChange: setPrimarySort,
        disabledReason: state.search.trim()
          ? t('viewMenus.searchOrderDescription')
          : undefined,
      }}
    />
  );
}
