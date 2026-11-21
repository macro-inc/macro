import type { EntityDetailTarget } from '@app/components/entity-detail/entity-detail-target';
import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { useListDetailNavigation } from '@app/components/list';
import { useRouteParams } from '@app/lib/split-router';
import { taskDetailRoute } from '@app/routes/routes';
import { MarkdownDetailBreadcrumbItem } from '@block-md/component/MarkdownDetailBreadcrumbItem';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';
import { MobileTaskDetailPane } from '../views/mobile/task-detail-pane';
import { TaskDetailPane } from '../views/task-detail-pane';
import { TaskDetail } from './TaskDetail';

export function TasksDetailView(props: {
  task: TaskDetailTarget;
  onClose?: () => void;
  breadcrumbOrder?: number;
}) {
  const { source, openTask, closeTask, selectedTask } = useTasksView();
  const panel = useSplitPanelOrThrow();
  const listNavigation = useListDetailNavigation({
    currentId: () => props.task.id,
    source,
    getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
    getContinuation: (row) => {
      if (row.kind !== 'load-more') return;
      const groupId = row.groupId;
      return groupId === undefined
        ? source.loadMore
        : () => source.loadMoreGroup(groupId);
    },
    open: (task) => openTask({ id: task.id, fallbackName: task.name }),
    onError: () => toast.failure('Unable to open the next or previous task'),
  });
  useListNavigationHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () =>
      panel.isPanelActive() && selectedTask()?.id === props.task.id,
    navigation: listNavigation,
  });
  const breadcrumbValue = () => `task:${props.task.id}`;
  const metadata = (): EntityDetailTarget => ({
    type: 'document',
    id: props.task.id,
    fileType: 'md',
    subType: { type: 'task' },
    fallbackName: props.task.fallbackName,
  });

  const detail = () => (
    <TaskDetail
      task={props.task}
      onDuplicate={(id, name) => openTask({ id, fallbackName: name })}
      onDelete={props.onClose ?? closeTask}
    >
      {(context) => (
        <MarkdownDetailBreadcrumbItem
          value={breadcrumbValue()}
          metadata={metadata()}
          order={props.breadcrumbOrder ?? 1}
          documentId={props.task.id}
          kind="task"
          fallbackName={props.task.fallbackName}
          ownerId={context.data.metadata.owner}
          projectId={context.data.metadata.projectId ?? undefined}
          onClose={props.onClose ?? closeTask}
          onDuplicate={(id, name) => openTask({ id, fallbackName: name })}
        />
      )}
    </TaskDetail>
  );

  return (
    <SidePanel.Root floating>
      <Show
        when={isTouchDevice()}
        fallback={
          <TaskDetailPane documentId={props.task.id}>{detail()}</TaskDetailPane>
        }
      >
        <MobileTaskDetailPane>{detail()}</MobileTaskDetailPane>
      </Show>
    </SidePanel.Root>
  );
}

export function TasksDetailRouteView() {
  const params = useRouteParams(taskDetailRoute);
  return <TasksDetailView task={{ id: params.taskId }} />;
}
