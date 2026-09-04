import { ViewShell } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Surface } from '@ui';
import { onMount, Suspense } from 'solid-js';
import { TasksHeader } from './components/TasksHeader';
import { TasksSidebar } from './components/TasksSidebar';
import { TaskList } from './components/task-list/TaskList';
import { TasksViewProvider } from './tasks-view-context';
import type { TasksViewStateOptions } from './types';

export type TasksViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: TasksViewStateOptions;
};

function TasksListFallback() {
  return (
    <Surface
      depth={2}
      class="grid min-h-0 min-w-0 place-items-center rounded-2xl text-ink-muted"
    >
      <SpinnerIcon aria-label="Loading tasks" class="size-5 animate-spin" />
    </Surface>
  );
}

function TasksViewRoot() {
  const panel = useSplitPanelOrThrow();

  onMount(() => panel.handle.setDisplayName('Tasks'));

  return (
    <ListEntityMetadataQueryProvider>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            resizable
            aside={{ preserveDuringResize: false }}
            main={{ preferredWidth: 640 }}
          >
            <ViewShell.Aside>
              <TasksSidebar />
            </ViewShell.Aside>
            <ViewShell.Main>
              <ViewShell.Header>
                <TasksHeader />
              </ViewShell.Header>
              <ViewShell.Content>
                <Suspense fallback={<TasksListFallback />}>
                  <TaskList />
                </Suspense>
              </ViewShell.Content>
            </ViewShell.Main>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </ListEntityMetadataQueryProvider>
  );
}

/** Production Tasks view. */
export function TasksView(props: TasksViewProps) {
  return (
    <TasksViewProvider initialState={props.initialState}>
      <TasksViewRoot />
    </TasksViewProvider>
  );
}
