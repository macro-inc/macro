import { EntityDetail } from '@app/components/entity-detail/EntityDetail';
import { EntityDetailBreadcrumbItem } from '@app/components/entity-detail/EntityDetailBreadcrumbItem';
import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import {
  EntityDetailNavigationStack,
  type EntityDetailNavigationStackEntry,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { useListDetailNavigation } from '@app/components/list';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import { MarkdownDetailBreadcrumbItem } from '@block-md/component/MarkdownDetailBreadcrumbItem';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { toast } from '@core/component/Toast/Toast';
import {
  ShareDialogContext,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import {
  createSignal,
  ErrorBoundary,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { TASK_TABS } from '../constants';
import { useTasksView } from '../tasks-view-context';
import type { TaskDetailTarget } from '../types';
import { TaskDetail, TaskDetailBodyState } from './TaskDetail';

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
        <ViewBreadcrumbs.ReturnButton
          isActive={item.isActive()}
          onClick={item.onSelect}
          tooltip={tabName()}
        >
          <span class="truncate">{tabName()}</span>
        </ViewBreadcrumbs.ReturnButton>
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
        <EntityDetailBreadcrumbItem entry={entry} order={index() + 1} />
      )}
    </For>
  );
}

function TaskDetailTopBar(props: {
  documentId: string;
  showTaskActions: boolean;
}) {
  const panel = useSplitPanelOrThrow();

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 border-edge border-b px-3">
      <SplitPanel.CloseButton class="hidden shrink-0 @max-[720px]/view-shell:flex" />
      <ViewBreadcrumbs.Outlet
        aria-label="Task location"
        fallback={<EntityDetailBreadcrumbSkeleton />}
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
      <EntityDetailBreadcrumbItem entry={props.entry} order={props.order} />
      <EntityDetail target={props.entry.data} />
    </>
  );
}

export function TasksDetailView(props: { task: TaskDetailTarget }) {
  const { source, openTask, closeTask } = useTasksView();
  const navigationStack = useEntityDetailNavigationStack();
  const panel = useSplitPanelOrThrow();
  const [shareOpen, setShareOpen] = createSignal(false);
  const taskEntry = () =>
    navigationStack.entries.find(
      (entry) =>
        entry.data.type === 'document' && entry.data.id === props.task.id
    );
  const isTaskActive = () =>
    navigationStack.active()?.value === taskEntry()?.value;
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
    enabled: () => panel.isPanelActive() && isTaskActive(),
    navigation: listNavigation,
  });

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
                          <MarkdownDetailBreadcrumbItem
                            value={entry.value}
                            metadata={entry.data}
                            order={state.entries.length}
                            documentId={props.task.id}
                            kind="task"
                            fallbackName={props.task.fallbackName}
                            ownerId={context.data.metadata.owner}
                            projectId={
                              context.data.metadata.projectId ?? undefined
                            }
                            onClose={closeTask}
                            onDuplicate={(id, name) =>
                              openTask({ id, fallbackName: name })
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
