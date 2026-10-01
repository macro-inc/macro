import { SearchBar } from '@app/components/view-shell';
import { TasksControls } from '@app/features/tasks-view/components/TasksControls';
import { TaskList } from '@app/features/tasks-view/components/task-list/TaskList';
import { useTasksDataSource } from '@app/features/tasks-view/queries/use-tasks-query';
import {
  TasksViewProvider,
  useTasksView,
} from '@app/features/tasks-view/tasks-view-context';
import { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import type { PropertyApiValues } from '@property/types';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { RecordSection } from './components/record-section';
import type { CrmRecordScope } from './core/record';
import {
  crmRecordPropertyId,
  crmRecordReferenceType,
} from './queries/record-items';

/**
 * The record's Tasks tab: the production Tasks list, scoped to tasks whose
 * Companies or Contacts property references the record. It owns its tag
 * sets because a standalone record has no list provider above it.
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
                { type: 'md', id: task.id },
                { preferNewSplit: options?.event?.shiftKey }
              );
              return true;
            }}
            onCloseTask={() => {}}
            sourceFactory={(state, options) =>
              useTasksDataSource(state, {
                ...options,
                reference: () => ({
                  propertyDefinitionId: crmRecordPropertyId(scope),
                  entityId: scope.id,
                }),
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

  // New tasks start associated with the record, like project tasks start
  // in their project.
  const association = (): [string, PropertyApiValues] => [
    crmRecordPropertyId(props.scope),
    {
      valueType: 'ENTITY',
      refs: [
        {
          entity_id: props.scope.id,
          entity_type: crmRecordReferenceType(props.scope),
        },
      ],
    },
  ];
  const composeTask = () =>
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        createTask: (
          ...[title, content, properties, ...rest]: Parameters<
            typeof createTaskWithProperties
          >
        ) =>
          createTaskWithProperties(
            title,
            content,
            [...properties, association()],
            ...rest
          ),
      },
    });

  return (
    <RecordSection
      title="Tasks"
      actions={
        <>
          <SearchBar
            label={`Search ${props.scope.type} tasks`}
            placeholder="Search tasks"
            class="w-56"
            value={state.search}
            onValueChange={(search) => setState('search', search)}
            onEscape={() => listElement?.focus()}
          />
          <TasksControls />
          <Button onClick={composeTask}>New task</Button>
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
