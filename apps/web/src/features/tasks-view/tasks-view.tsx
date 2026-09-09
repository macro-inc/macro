import { ViewShell } from '@app/components/view-shell';
import { ListContentPreview } from '@app/components/view-shell/ListContentPreview';
import { RightContentPanel } from '@components/app/RightContentPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { cn, Surface } from '@ui';
import { onMount, Show, Suspense } from 'solid-js';
import { TasksControls } from './components/TasksControls';
import { TasksHeader } from './components/TasksHeader';
import { TasksSidebar } from './components/TasksSidebar';
import { TaskList } from './components/task-list/TaskList';
import { TasksViewProvider, useTasksView } from './tasks-view-context';
import type { TasksViewStateOptions } from './types';

export type TasksViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: TasksViewStateOptions;
};

function TasksListFallback() {
  return (
    <Surface
      depth={isTouchDevice() ? 0 : 2}
      hideBorder={isTouchDevice()}
      class={cn('grid min-h-0 min-w-0 place-items-center text-ink-muted', {
        'rounded-2xl': !isTouchDevice(),
        'rounded-none bg-transparent': isTouchDevice(),
      })}
    >
      <SpinnerIcon aria-label="Loading tasks" class="size-5 animate-spin" />
    </Surface>
  );
}

function TasksViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { state } = useTasksView();
  const title = () =>
    state.tab === 'my-tasks'
      ? 'My Tasks'
      : state.tab === 'team-tasks'
        ? 'All Tasks'
        : 'Created by me';

  onMount(() => panel.handle.setDisplayName('Tasks'));

  return (
    <ListEntityMetadataQueryProvider>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            resizable
            aside={{ width: 288, min: 224, max: 320 }}
            main={{ preferredWidth: 640 }}
          >
            <ViewShell.Aside>
              <TasksSidebar />
            </ViewShell.Aside>
            <ViewShell.Main>
              <RightContentPanel>
                <ListContentPreview
                  title={title()}
                  viewKey={JSON.stringify([state.tab, state.facets])}
                >
                  {() => (
                    <>
                      <TasksHeader />
                      <Show when={!isTouchDevice()}>
                        <TasksControls />
                      </Show>
                      <div class="min-h-0 min-w-0 flex-1">
                        <Suspense fallback={<TasksListFallback />}>
                          <TaskList />
                        </Suspense>
                      </div>
                    </>
                  )}
                </ListContentPreview>
              </RightContentPanel>
            </ViewShell.Main>
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 border-b border-edge-muted"
            />
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
