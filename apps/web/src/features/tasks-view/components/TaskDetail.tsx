import { ViewBreadcrumbs } from '@app/components/view-shell';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
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
import { Permissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { buildEntityData } from '@entity';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button } from '@ui';
import {
  createResource,
  createSignal,
  ErrorBoundary,
  Match,
  onCleanup,
  onMount,
  type Resource,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { TASK_TABS } from '../constants';
import {
  loadTaskDocument,
  type TaskDocumentData,
} from '../queries/task-document';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';

const TASK_BREADCRUMB_SKELETON_DELAY_MS = 150;

function TaskViewBreadcrumbItem() {
  const { state } = useTasksView();
  const tabName = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';

  return (
    <ViewBreadcrumbs.Item value="tasks-view" order={0}>
      {(item) => (
        <ViewBreadcrumbs.Button
          isActive={item.isActive()}
          onClick={item.onSelect}
        >
          <span class="truncate">{tabName()}</span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function TaskBreadcrumbItem(props: {
  documentId: string;
  fallbackName: string;
  ownerId: string;
  projectId?: string;
}) {
  const { closeTask, openTask } = useTasksView();
  const panel = useSplitPanelOrThrow();
  const { displayName } = useMarkdownName();
  const { permissions, state: documentState } = useMarkdownDocument();
  const { fileOperations, menuTools } = useMarkdownDocumentTools();

  const taskName = () => displayName() ?? props.fallbackName;

  const focusTask = () => documentState.editor.md.editor?.focus();

  const menuPermissions = () => {
    if (permissions.isOwner()) return Permissions.OWNER;
    if (permissions.canEdit()) return Permissions.CAN_EDIT;
    if (permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  useBlockEntityCommands({
    id: props.documentId,
    scopeId: panel.splitHotkeyScope,
    onDeleted: closeTask,
    resolveEntity: () =>
      buildEntityData({
        id: props.documentId,
        name: taskName(),
        blockName: 'task',
        ownerId: props.ownerId,
        projectId: props.projectId,
      }),
  });

  return (
    <ViewBreadcrumbs.Item value={`task:${props.documentId}`} order={1}>
      {(item) => (
        <div class="flex min-w-0 items-center motion-safe:animate-[dialog-overlay-open_150ms_ease-out]">
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={() => {
              item.onSelect();
              focusTask();
            }}
          >
            <EntityIcon targetType="task" size="xs" class="shrink-0" />
            <span class="truncate">{taskName()}</span>
          </ViewBreadcrumbs.Button>
          <div class="shrink-0">
            <SplitFileMenu
              id={props.documentId}
              itemType="document"
              name={taskName()}
              ops={fileOperations}
              tools={menuTools}
              entityKind="task"
              permissions={menuPermissions()}
              onDuplicate={(id) => openTask({ id, fallbackName: taskName() })}
              onDelete={closeTask}
            />
          </div>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function TaskDetailTopBar(props: {
  documentId: string;
  document: Resource<TaskDocumentData>;
}) {
  const panel = useSplitPanelOrThrow();

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 border-edge border-b px-3">
      <ViewBreadcrumbs.Outlet aria-label="Task location">
        <Suspense fallback={<TaskBreadcrumbSkeleton />}>
          {props.document.latest && null}
        </Suspense>
      </ViewBreadcrumbs.Outlet>
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

function TaskBreadcrumbSkeleton() {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const timeoutId = window.setTimeout(
      () => setVisible(true),
      TASK_BREADCRUMB_SKELETON_DELAY_MS
    );
    onCleanup(() => window.clearTimeout(timeoutId));
  });

  return (
    <Show when={visible()}>
      <ViewBreadcrumbs.Separator />
      <div
        aria-hidden="true"
        class="flex h-7 min-w-0 items-center gap-1.5 px-1"
      >
        <span class="skeleton-shimmer size-4 shrink-0 rounded bg-skeleton" />
        <span class="skeleton-shimmer h-3 w-24 rounded-full bg-skeleton" />
      </div>
    </Show>
  );
}

function TaskDetailBodyState(props: {
  error?: unknown;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const errorText = () => String(props.error);

  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <Switch
        fallback={
          <SpinnerIcon aria-label="Loading task" class="size-5 animate-spin" />
        }
      >
        <Match when={props.error !== undefined}>
          <div class="flex max-w-xl flex-col items-center gap-3 px-6 text-center">
            <span>This task couldn’t be displayed.</span>
            <pre class="max-h-48 max-w-full overflow-auto whitespace-pre-wrap text-left text-failure text-xs">
              {errorText()}
            </pre>
            <Button variant="outline" size="sm" onClick={props.onAction}>
              {props.actionLabel ?? 'Reset'}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function TaskDetailDocument(props: {
  task: TaskDetailTarget;
  data: TaskDocumentData;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
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
      <ModalsProvider
        shareOpen={props.shareOpen}
        onShareOpenChange={props.onShareOpenChange}
      >
        <OldOverlay />
        <TaskBreadcrumbItem
          documentId={props.task.id}
          fallbackName={fallbackName()}
          ownerId={props.data.metadata.owner}
          projectId={props.data.metadata.projectId ?? undefined}
        />
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
      </ModalsProvider>
    </MarkdownDocument>
  );
}

export function TaskDetail(props: { task: TaskDetailTarget }) {
  const { closeTask } = useTasksView();
  const [document, { refetch }] = createResource(
    () => props.task.id,
    loadTaskDocument
  );
  const [shareOpen, setShareOpen] = createSignal(false);

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <ViewBreadcrumbs.Root
        value={`task:${props.task.id}`}
        onChange={(value) => {
          if (value === 'tasks-view') closeTask();
        }}
      >
        <TaskViewBreadcrumbItem />
        <SidePanel.Root>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <TaskDetailTopBar documentId={props.task.id} document={document} />
            <div class="relative min-h-0 min-w-0 flex-1">
              <Suspense fallback={<TaskDetailBodyState />}>
                <Switch>
                  <Match when={document.error}>
                    {(error) => (
                      <TaskDetailBodyState
                        error={error()}
                        actionLabel="Try again"
                        onAction={() => void refetch()}
                      />
                    )}
                  </Match>
                  <Match when={document()}>
                    {(data) => (
                      <ErrorBoundary
                        fallback={(error, reset) => (
                          <TaskDetailBodyState
                            error={error}
                            actionLabel="Reset"
                            onAction={reset}
                          />
                        )}
                      >
                        <TaskDetailDocument
                          task={props.task}
                          data={data()}
                          shareOpen={shareOpen()}
                          onShareOpenChange={setShareOpen}
                        />
                      </ErrorBoundary>
                    )}
                  </Match>
                </Switch>
              </Suspense>
            </div>
          </div>
        </SidePanel.Root>
      </ViewBreadcrumbs.Root>
    </ShareDialogContext.Provider>
  );
}
