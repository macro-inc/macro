import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { TaskList } from '@app/features/tasks-view/components/task-list/TaskList';
import { useTasksDataSource } from '@app/features/tasks-view/queries/use-tasks-query';
import {
  TasksViewProvider,
  useTasksView,
} from '@app/features/tasks-view/tasks-view-context';
import { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  enableCrmActivity,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import PlusIcon from '@phosphor/plus.svg';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { RecordSection } from './components/record-section';
import type { CrmRecordScope } from './core/record';
import { crmTaskComposerContext } from './task-composer';

/**
 * The record's Tasks tab: the production Tasks list, scoped to tasks
 * associated with the record through its Companies or Contacts property or a
 * reference (for a company, also through any of its contacts). It owns its
 * tag sets because a standalone record has no list provider above it.
 */
export function CrmRecordTasks(props: { scope: CrmRecordScope }) {
  const layout = useSplitLayout();
  return (
    <Show when={props.scope} keyed>
      {(scope) => (
        <TagSetsQueryProvider>
          <TasksViewProvider
            initialState={{ tab: 'team-tasks', groupBy: 'status', facets: {} }}
            restoreEntryState
            scopeKey={`crm:${scope.type}:${scope.id}:tasks`}
            onOpenTask={(task, options) => {
              layout.openWithSplit(
                { type: 'task', id: task.id },
                { preferNewSplit: options?.event?.shiftKey }
              );
              return true;
            }}
            onCloseTask={() => {}}
            sourceFactory={(state, options) =>
              useTasksDataSource(state, {
                ...options,
                crm: () => ({ type: scope.type, id: scope.id }),
              })
            }
          >
            <RecordTasksBody scope={scope} />
          </TasksViewProvider>
        </TagSetsQueryProvider>
      )}
    </Show>
  );
}

function RecordTasksBody(props: { scope: CrmRecordScope }) {
  const { state, setState } = useTasksView();
  const layout = useSplitLayout();
  let listElement: HTMLDivElement | undefined;

  const composeTask = () => {
    const context = crmTaskComposerContext(props.scope);
    const adaptive = isFeatureEnabled(enableCrmActivity);
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        composerContext: adaptive ? context : undefined,
        // Keep the existing record associations with the standard composer.
        createTask: adaptive
          ? undefined
          : (
              ...[title, content, properties, ...rest]: Parameters<
                typeof createTaskWithProperties
              >
            ) =>
              createTaskWithProperties(
                title,
                content,
                [
                  ...properties,
                  ...Object.entries(context.initialPropertyValues ?? {}),
                ],
                ...rest
              ),
      },
    });
  };

  return (
    <RecordSection
      title="Tasks"
      search={state.search}
      onSearchChange={(search) => setState('search', search)}
      onSearchEscape={() => listElement?.focus()}
      actions={
        <>
          <TasksControls />
          <Button variant="outline" onClick={composeTask}>
            <PlusIcon class="size-4" />
            New task
          </Button>
        </>
      }
    >
      <TaskList
        ref={(element) => {
          listElement = element;
        }}
      />
    </RecordSection>
  );
}
