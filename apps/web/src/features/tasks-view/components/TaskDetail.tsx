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
import { loadTaskDocument } from '../queries/task-document';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';

const LOADING_PERMISSIONS = {
  canComment: false,
  canEdit: false,
  isOwner: false,
};

function TaskBreadcrumbLabel(props: { taskName: string }) {
  return (
    <>
      <EntityIcon targetType="task" size="xs" class="shrink-0" />
      <span class="truncate">{props.taskName}</span>
    </>
  );
}

function TaskViewBreadcrumbItem() {
  const { state, closeTask } = useTasksView();
  const tabName = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';

  return (
    <ViewBreadcrumbs.Item id="tasks-view" order={0} onClick={closeTask}>
      <span class="truncate">{tabName()}</span>
    </ViewBreadcrumbs.Item>
  );
}

function TaskBreadcrumbItem(props: {
  documentId: string;
  fallbackName: string;
}) {
  const { closeTask } = useTasksView();
  const { displayName } = useMarkdownName();
  const { permissions, state: documentState } = useMarkdownDocument();
  const { fileOperations, menuTools } = useMarkdownDocumentTools();
  const taskName = () => displayName() ?? props.fallbackName;
  const focusTask = () => documentState.editor.md.editor?.focus();

  return (
    <ViewBreadcrumbs.Item
      id={`task:${props.documentId}`}
      order={1}
      current
      class="gap-1.5"
      onClick={focusTask}
      suffix={
        <div class="shrink-0">
          <SplitFileMenu
            id={props.documentId}
            itemType="document"
            name={taskName()}
            ops={fileOperations}
            tools={menuTools}
            blockName="md"
            blockAlias="task"
            isOwner={permissions.isOwner()}
            onDelete={closeTask}
          />
        </div>
      }
    >
      <TaskBreadcrumbLabel taskName={taskName()} />
    </ViewBreadcrumbs.Item>
  );
}

function TaskDetailTopBar(props: { documentId: string }) {
  const panel = useSplitPanelOrThrow();

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 border-edge border-b px-3">
      <ViewBreadcrumbs.Outlet aria-label="Task location" />
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

function TaskDetailBodyState(props: { error?: boolean; onRetry?: () => void }) {
  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <Switch
        fallback={
          <SpinnerIcon aria-label="Loading task" class="size-5 animate-spin" />
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
  );
}

export function TaskDetail(props: { task: TaskDetailTarget }) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const [document, { refetch }] = createResource(
    () => props.task.id,
    loadTaskDocument
  );
  const fallbackName = () => props.task.fallbackName ?? 'New Task';
  const data = () => document.latest;
  const documentSource = () => {
    const loaded = data();
    return loaded
      ? ({ type: 'sync', source: loaded.source } as const)
      : ({ type: 'loading' } as const);
  };
  const permissions = () => data()?.permissions ?? LOADING_PERMISSIONS;

  return (
    <MarkdownDocument
      documentId={props.task.id}
      kind="task"
      documentSource={documentSource()}
      permissions={permissions()}
      persistedName={data()?.metadata.documentName}
      fallbackName={fallbackName()}
    >
      <ModalsProvider>
        <OldOverlay />
        <ViewBreadcrumbs.Root>
          <TaskViewBreadcrumbItem />
          <SidePanel.Root>
            <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
              <TaskDetailTopBar documentId={props.task.id} />
              <div class="relative min-h-0 min-w-0 flex-1">
                <Switch fallback={<TaskDetailBodyState />}>
                  <Match when={document.error}>
                    <TaskDetailBodyState error onRetry={() => refetch()} />
                  </Match>
                  <Match when={data()}>
                    {(loaded) => (
                      <Suspense fallback={<TaskDetailBodyState />}>
                        <TaskBreadcrumbItem
                          documentId={props.task.id}
                          fallbackName={fallbackName()}
                        />
                        <SidePanel.Layout headerToggle={false}>
                          <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
                            <MarkdownSidePanelSections />
                          </Show>
                          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
                            <div class="absolute top-1.5 right-4 z-action-menu flex justify-end">
                              <FindAndReplace
                                hotkeyScope={panel.splitHotkeyScope}
                              />
                            </div>
                            <DocumentDebouncedNotificationReadMarker
                              notificationSource={notificationSource}
                              documentId={props.task.id}
                            />
                            <MarkdownDocumentContent
                              hotkeyScope={panel.splitHotkeyScope}
                              doInitialSync={loaded().doInitialSync}
                              loadCachedSnapshot={() =>
                                loadMarkdownCachedSnapshot(props.task.id)
                              }
                            />
                          </div>
                        </SidePanel.Layout>
                      </Suspense>
                    )}
                  </Match>
                </Switch>
              </div>
            </div>
          </SidePanel.Root>
        </ViewBreadcrumbs.Root>
      </ModalsProvider>
    </MarkdownDocument>
  );
}
