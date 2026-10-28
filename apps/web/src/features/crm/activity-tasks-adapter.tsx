import { SearchBar, ViewShell } from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { useTasksDataSource } from '@app/features/tasks-view/queries/use-tasks-query';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import {
  TasksViewProvider,
  useTasksView,
} from '@app/features/tasks-view/tasks-view-context';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlusIcon from '@icon/system/regular/plus.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { useCrmContext } from './context/crm-context';

/** Production Tasks layouts for the workspace-wide CRM activity scope. */
export function CrmActivityTasks(props: { title?: JSX.Element }) {
  const crm = useCrmContext();
  const layout = useSplitLayout();
  return (
    <TagSetsQueryProvider>
      <TasksViewProvider
        initialState={{ tab: 'team-tasks', groupBy: 'date' }}
        restoreEntryState
        scopeKey="crm:activity:tasks"
        onOpenTask={(task, options) => {
          layout.openWithSplit(
            { type: 'task', id: task.id },
            { preferNewSplit: options?.event?.shiftKey }
          );
          return true;
        }}
        onCloseTask={() => {}}
        onCreateTask={(options) => crm.openTaskComposer(options)}
        sourceFactory={(state, options) =>
          useTasksDataSource(state, {
            ...options,
            crm: () => ({ type: 'activity' }),
          })
        }
      >
        <ActivityTasksBody
          title={props.title}
          onCreateTask={crm.openTaskComposer}
        />
      </TasksViewProvider>
    </TagSetsQueryProvider>
  );
}

function ActivityTasksBody(props: {
  title?: JSX.Element;
  onCreateTask: () => void;
}) {
  const { state, setState, source } = useTasksView();
  let listElement: HTMLDivElement | undefined;
  const controls = () => (
    <>
      <TasksControls />
      <Show
        when={!isTouchDevice()}
        fallback={
          <Button variant="secondary" onClick={() => props.onCreateTask()}>
            <PlusIcon class="size-4" />
            New task
          </Button>
        }
      >
        <ViewCreateButton
          aria-label="New task"
          onClick={() => props.onCreateTask()}
        />
      </Show>
    </>
  );
  return (
    <div class="flex size-full min-h-0 flex-col">
      <Show
        when={!isTouchDevice()}
        fallback={
          <ViewShell.Header>
            <div class="flex min-w-0 items-center gap-2 px-4 py-2">
              {controls()}
              <SearchBar
                label="Search tasks"
                placeholder="Search tasks"
                value={state.search}
                onValueChange={(search) => setState('search', search)}
                class="min-w-0 flex-1"
              />
            </div>
          </ViewShell.Header>
        }
      >
        <ListHeader title={props.title ?? 'Tasks'}>
          {controls()}
          <ListHeaderSearch
            label="Search tasks"
            value={state.search}
            onValueChange={(search) => setState('search', search)}
            onEscape={() => listElement?.focus()}
            registerFocus={() => {}}
          />
        </ListHeader>
      </Show>
      <Show when={source.paginationError?.()}>
        <div
          role="alert"
          class="flex items-center gap-3 px-3 py-2 text-sm text-ink-muted"
        >
          Some tasks could not be loaded.
          <Button size="sm" onClick={() => source.retryPagination?.()}>
            Try again
          </Button>
        </div>
      </Show>
      <div class="min-h-0 flex-1">
        <TasksContent
          ref={(element) => {
            listElement = element;
          }}
          referencePropertyIds={[
            SYSTEM_PROPERTY_IDS.COMPANIES,
            SYSTEM_PROPERTY_IDS.CONTACTS,
          ]}
        />
      </div>
    </div>
  );
}
