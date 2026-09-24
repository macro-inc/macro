import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import type { EntityDetailTarget } from '@app/components/entity-detail/EntityDetailNavigationStack';
import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { useListDetailNavigation } from '@app/components/list';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useRouteParams } from '@app/lib/split-router';
import { MarkdownDetailBreadcrumbItem } from '@block-md/component/MarkdownDetailBreadcrumbItem';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  ShareDialogContext,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { createSignal } from 'solid-js';
import { taskDetailRoute } from '../route';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';
import { TaskDetail } from './TaskDetail';

function TaskDetailTopBar(props: { documentId: string }) {
  const panel = useSplitPanelOrThrow();

  return (
    <ViewShell.TopBar class="touch:flex">
      <ViewBreadcrumbs.Outlet
        aria-label="Task location"
        fallback={<EntityDetailBreadcrumbSkeleton />}
      />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <ShareTrigger
          id={props.documentId}
          blockType="task"
          hotkeyScope={panel.splitHotkeyScope}
        />
        <SidePanel.Toggle />
      </div>
    </ViewShell.TopBar>
  );
}

export function TasksDetailView(props: { task: TaskDetailTarget }) {
  const { source, openTask, closeTask, selectedTask } = useTasksView();
  const panel = useSplitPanelOrThrow();
  const [shareOpen, setShareOpen] = createSignal(false);
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

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <SidePanel.Root>
        <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
          <TaskDetailTopBar documentId={props.task.id} />
          <div class="relative min-h-0 min-w-0 flex-1">
            <TaskDetail
              task={props.task}
              shareOpen={shareOpen()}
              onShareOpenChange={setShareOpen}
            >
              {(context) => (
                <MarkdownDetailBreadcrumbItem
                  value={breadcrumbValue()}
                  metadata={metadata()}
                  order={1}
                  documentId={props.task.id}
                  kind="task"
                  fallbackName={props.task.fallbackName}
                  ownerId={context.data.metadata.owner}
                  projectId={context.data.metadata.projectId ?? undefined}
                  onClose={closeTask}
                  onDuplicate={(id, name) =>
                    openTask({ id, fallbackName: name })
                  }
                />
              )}
            </TaskDetail>
          </div>
        </div>
      </SidePanel.Root>
    </ShareDialogContext.Provider>
  );
}

export function TasksDetailRouteView() {
  const params = useRouteParams(taskDetailRoute);
  return <TasksDetailView task={{ id: params.taskId }} />;
}
