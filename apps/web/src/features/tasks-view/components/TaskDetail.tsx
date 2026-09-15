import { ViewBreadcrumbs } from '@app/components/view-shell';
import { FindAndReplace } from '@block-md/component/FindAndReplace';
import {
  MarkdownDocument,
  MarkdownDocumentContent,
} from '@block-md/component/MarkdownDocument';
import { useMarkdownName } from '@block-md/component/MarkdownNameProvider';
import { ModalsProvider } from '@block-md/component/ModalsProvider';
import { MarkdownSidePanelSections } from '@block-md/component/sidepanel/MarkdownSidePanelSections';
import { useMarkdownDocumentTools } from '@block-md/component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '@block-md/context/markdown-document-context';
import { OldOverlay } from '@block-md/history/OldOverlay';
import { loadMarkdownCachedSnapshot } from '@block-md/queries/markdown-document-operations';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button } from '@ui';
import { createResource, Match, Show, Suspense, Switch } from 'solid-js';
import { TASK_TABS } from '../constants';
import {
  loadTaskDocument,
  type TaskDocumentData,
} from '../queries/task-document';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';

function TaskBreadcrumbLabel(props: { taskName: string }) {
  return (
    <>
      <EntityIcon targetType="task" size="xs" class="shrink-0" />
      <span class="truncate">{props.taskName}</span>
    </>
  );
}

function TaskDetailBreadcrumb(props: {
  taskName: string;
  onTaskClick?: () => void;
}) {
  const { state, closeTask } = useTasksView();
  const tabName = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';

  return (
    <ViewBreadcrumbs.Root aria-label="Task location">
      <ViewBreadcrumbs.Item onClick={closeTask}>
        <span class="truncate">{tabName()}</span>
      </ViewBreadcrumbs.Item>
      <ViewBreadcrumbs.Separator />
      <ViewBreadcrumbs.Item current class="gap-1.5" onClick={props.onTaskClick}>
        <TaskBreadcrumbLabel taskName={props.taskName} />
      </ViewBreadcrumbs.Item>
    </ViewBreadcrumbs.Root>
  );
}

function TaskDetailBreadcrumbRegistration(props: {
  documentId: string;
  fallbackName: string;
}) {
  const { state, closeTask } = useTasksView();
  const { displayName } = useMarkdownName();
  const { state: documentState } = useMarkdownDocument();
  const tabName = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';
  const taskName = () => displayName() ?? props.fallbackName;
  const focusTask = () => documentState.editor.md.editor?.focus();

  return (
    <>
      <ViewBreadcrumbs.Register id="tasks-view" order={0} onClick={closeTask}>
        <span class="truncate">{tabName()}</span>
      </ViewBreadcrumbs.Register>
      <ViewBreadcrumbs.Register
        id={`task:${props.documentId}`}
        order={1}
        current
        class="gap-1.5"
        onClick={focusTask}
      >
        <TaskBreadcrumbLabel taskName={taskName()} />
      </ViewBreadcrumbs.Register>
    </>
  );
}

function TaskDetailTopBar(props: {
  documentId: string;
  fallbackName: string;
  isOwner: boolean;
}) {
  const panel = useSplitPanelOrThrow();
  const { closeTask } = useTasksView();
  const { displayName } = useMarkdownName();
  const { fileOperations, menuTools } = useMarkdownDocumentTools();
  const taskName = () => displayName() ?? props.fallbackName;

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 border-edge border-b px-3">
      <ViewBreadcrumbs.Outlet aria-label="Task location" />
      <div class="shrink-0">
        <SplitFileMenu
          id={props.documentId}
          itemType="document"
          name={taskName()}
          ops={fileOperations}
          tools={menuTools}
          blockName="md"
          blockAlias="task"
          isOwner={props.isOwner}
          onDelete={closeTask}
        />
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <ShareTrigger
          id={props.documentId}
          blockType="task"
          hotkeyScope={panel.splitHotkeyScope}
        />
        <SidePanel.Toggle />
      </div>
    </div>
  );
}

function TaskDetailLoadState(props: {
  taskName: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div class="flex size-full flex-col">
      <div class="flex h-12 shrink-0 items-center gap-1 border-edge border-b px-3">
        <TaskDetailBreadcrumb taskName={props.taskName} />
      </div>
      <div class="grid min-h-0 flex-1 place-items-center text-ink-muted">
        <Switch
          fallback={
            <SpinnerIcon
              aria-label="Loading task"
              class="size-5 animate-spin"
            />
          }
        >
          <Match when={props.error}>
            <div class="flex flex-col items-center gap-3">
              <span>This task couldn’t be loaded.</span>
              <Button variant="outline" size="sm" onClick={props.onRetry}>
                Try again
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function TaskDetailContent(props: {
  task: TaskDetailTarget;
  data: TaskDocumentData;
}) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const fallbackName = () => props.task.fallbackName ?? 'New Task';

  return (
    <MarkdownDocument
      documentId={props.task.id}
      kind="task"
      documentSource={{ type: 'sync', source: props.data.source }}
      permissions={props.data.permissions}
      persistedName={props.data.metadata.documentName}
      fallbackName={fallbackName()}
    >
      <ModalsProvider>
        <OldOverlay />
        <ViewBreadcrumbs.Provider>
          <TaskDetailBreadcrumbRegistration
            documentId={props.task.id}
            fallbackName={fallbackName()}
          />
          <SidePanel.Root>
            <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
              <TaskDetailTopBar
                documentId={props.task.id}
                fallbackName={fallbackName()}
                isOwner={props.data.permissions.isOwner}
              />
              <div class="relative min-h-0 min-w-0 flex-1">
                <Suspense
                  fallback={
                    <div class="grid size-full place-items-center text-ink-muted">
                      <SpinnerIcon class="size-5 animate-spin" />
                    </div>
                  }
                >
                  <SidePanel.Layout headerToggle={false}>
                    <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
                      <MarkdownSidePanelSections />
                    </Show>
                    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
                      <div class="absolute top-1.5 right-4 z-action-menu flex justify-end">
                        <FindAndReplace hotkeyScope={panel.splitHotkeyScope} />
                      </div>
                      <DocumentDebouncedNotificationReadMarker
                        notificationSource={notificationSource}
                        documentId={props.task.id}
                      />
                      <MarkdownDocumentContent
                        hotkeyScope={panel.splitHotkeyScope}
                        doInitialSync={props.data.doInitialSync}
                        loadCachedSnapshot={() =>
                          loadMarkdownCachedSnapshot(props.task.id)
                        }
                      />
                    </div>
                  </SidePanel.Layout>
                </Suspense>
              </div>
            </div>
          </SidePanel.Root>
        </ViewBreadcrumbs.Provider>
      </ModalsProvider>
    </MarkdownDocument>
  );
}

export function TaskDetail(props: { task: TaskDetailTarget }) {
  const [document, { refetch }] = createResource(
    () => props.task.id,
    loadTaskDocument
  );
  const fallbackName = () => props.task.fallbackName ?? 'New Task';

  return (
    <Switch fallback={<TaskDetailLoadState taskName={fallbackName()} />}>
      <Match when={document.error}>
        <TaskDetailLoadState
          taskName={fallbackName()}
          error
          onRetry={() => refetch()}
        />
      </Match>
      <Match when={document.latest}>
        {(data) => (
          <Suspense
            fallback={<TaskDetailLoadState taskName={fallbackName()} />}
          >
            <TaskDetailContent task={props.task} data={data()} />
          </Suspense>
        )}
      </Match>
    </Switch>
  );
}
