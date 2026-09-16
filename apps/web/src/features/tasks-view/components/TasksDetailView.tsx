import { EntityDetail } from '@app/components/entity-detail/EntityDetail';
import {
  EntityDetailNavigationStack,
  type EntityDetailNavigationStackEntry,
  type EntityDetailTarget,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useMarkdownName } from '@block-md/component/MarkdownNameProvider';
import { useMarkdownDocumentTools } from '@block-md/component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '@block-md/context/markdown-document-context';
import { SidePanel } from '@components/app/side-panel';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { Permissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { buildEntityData } from '@entity';
import {
  createSignal,
  ErrorBoundary,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { TASK_TABS } from '../constants';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';
import { TaskDetail, TaskDetailBodyState } from './TaskDetail';

const TASK_BREADCRUMB_SKELETON_DELAY_MS = 150;
type EntityDetailEntry = EntityDetailNavigationStackEntry;

function TaskViewBreadcrumbItem() {
  const { state } = useTasksView();
  const tabName = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';

  return (
    <ViewBreadcrumbs.Item
      value="tasks-view"
      metadata={{ type: 'tasks' }}
      order={0}
    >
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

function detailBreadcrumbIcon(target: EntityDetailTarget): EntityIconSelector {
  if (target.type === 'document') {
    return (target.subType?.type ??
      target.fileType ??
      'unknown') as EntityIconSelector;
  }
  if (
    target.type === 'channel' ||
    target.type === 'channel_message' ||
    target.type === 'channel_thread'
  ) {
    return 'channel';
  }
  return fileTypeToBlockName(target.type, true);
}

function detailBreadcrumbName(target: EntityDetailTarget) {
  if (target.fallbackName) return target.fallbackName;

  if (target.type === 'document' && target.subType?.type === 'task') {
    return 'New Task';
  }
  if (
    target.type === 'channel' ||
    target.type === 'channel_message' ||
    target.type === 'channel_thread'
  ) {
    return 'Channel';
  }
  return 'Untitled';
}

function DetailBreadcrumbItem(props: {
  entry: EntityDetailEntry;
  order: number;
}) {
  return (
    <ViewBreadcrumbs.Item
      value={props.entry.value}
      metadata={props.entry.data}
      order={props.order}
    >
      {(item) => (
        <ViewBreadcrumbs.Button
          class="gap-1.5"
          isActive={item.isActive()}
          onClick={item.onSelect}
        >
          <EntityIcon
            targetType={detailBreadcrumbIcon(props.entry.data)}
            size="xs"
            class="shrink-0"
          />
          <span class="truncate">{detailBreadcrumbName(props.entry.data)}</span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function TaskDetailAncestorBreadcrumbs() {
  const navigationStack = useEntityDetailNavigationStack();
  const ancestors = () => navigationStack.entries.slice(0, -1);

  return (
    <For each={ancestors()}>
      {(entry, index) => (
        <DetailBreadcrumbItem entry={entry} order={index() + 1} />
      )}
    </For>
  );
}

function TaskBreadcrumbItem(props: {
  entry: EntityDetailEntry;
  order: number;
  task: TaskDetailTarget;
  ownerId: string;
  projectId?: string;
}) {
  const { closeTask, openTask } = useTasksView();
  const panel = useSplitPanelOrThrow();
  const { displayName } = useMarkdownName();
  const { permissions, state: documentState } = useMarkdownDocument();
  const { fileOperations, menuTools } = useMarkdownDocumentTools();
  const taskName = () => displayName() ?? props.task.fallbackName ?? 'New Task';
  const focusTask = () => documentState.editor.md.editor?.focus();

  const menuPermissions = () => {
    if (permissions.isOwner()) return Permissions.OWNER;
    if (permissions.canEdit()) return Permissions.CAN_EDIT;
    if (permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  useBlockEntityCommands({
    id: props.task.id,
    scopeId: panel.splitHotkeyScope,
    onDeleted: closeTask,
    resolveEntity: () =>
      buildEntityData({
        id: props.task.id,
        name: taskName(),
        blockName: 'task',
        ownerId: props.ownerId,
        projectId: props.projectId,
      }),
  });

  return (
    <ViewBreadcrumbs.Item
      value={props.entry.value}
      metadata={props.entry.data}
      order={props.order}
    >
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
              id={props.task.id}
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

function TaskDetailTopBar(props: {
  documentId: string;
  showTaskActions: boolean;
}) {
  const panel = useSplitPanelOrThrow();

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 border-edge border-b px-3">
      <ViewBreadcrumbs.Outlet
        aria-label="Task location"
        fallback={<TaskBreadcrumbSkeleton />}
      />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <Show when={props.showTaskActions}>
          <ShareTrigger
            id={props.documentId}
            blockType="task"
            hotkeyScope={panel.splitHotkeyScope}
          />
        </Show>
        <SidePanel.Toggle />
      </div>
    </div>
  );
}

function StackEntityDetail(props: { entry: EntityDetailEntry; order: number }) {
  return (
    <>
      <DetailBreadcrumbItem entry={props.entry} order={props.order} />
      <EntityDetail target={props.entry.data} />
    </>
  );
}

export function TasksDetailView(props: { task: TaskDetailTarget }) {
  const { closeTask } = useTasksView();
  const navigationStack = useEntityDetailNavigationStack();
  const [shareOpen, setShareOpen] = createSignal(false);
  const taskEntry = () =>
    navigationStack.entries.find(
      (entry) =>
        entry.data.type === 'document' && entry.data.id === props.task.id
    );
  const isTaskActive = () =>
    navigationStack.active()?.value === taskEntry()?.value;

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <ViewBreadcrumbs.Root
        value={navigationStack.active()?.value ?? 'tasks-view'}
        onChange={(value) => {
          if (value === 'tasks-view') {
            closeTask();
            return;
          }
          navigationStack.popTo(value);
        }}
      >
        <TaskViewBreadcrumbItem />
        <TaskDetailAncestorBreadcrumbs />
        <SidePanel.Root>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <TaskDetailTopBar
              documentId={props.task.id}
              showTaskActions={isTaskActive()}
            />
            <div class="relative min-h-0 min-w-0 flex-1">
              <EntityDetailNavigationStack.Outlet>
                {(entry, state) => (
                  <Switch>
                    <Match when={entry.value === taskEntry()?.value}>
                      <TaskDetail
                        task={props.task}
                        shareOpen={shareOpen()}
                        onShareOpenChange={setShareOpen}
                      >
                        {(context) => (
                          <TaskBreadcrumbItem
                            entry={entry}
                            order={state.entries.length}
                            task={props.task}
                            ownerId={context.data.metadata.owner}
                            projectId={
                              context.data.metadata.projectId ?? undefined
                            }
                          />
                        )}
                      </TaskDetail>
                    </Match>
                    <Match when={true}>
                      <ErrorBoundary
                        fallback={(error, reset) => (
                          <TaskDetailBodyState
                            error={error}
                            actionLabel="Reset"
                            onAction={reset}
                          />
                        )}
                      >
                        <StackEntityDetail
                          entry={entry}
                          order={state.entries.length}
                        />
                      </ErrorBoundary>
                    </Match>
                  </Switch>
                )}
              </EntityDetailNavigationStack.Outlet>
            </div>
          </div>
        </SidePanel.Root>
      </ViewBreadcrumbs.Root>
    </ShareDialogContext.Provider>
  );
}
