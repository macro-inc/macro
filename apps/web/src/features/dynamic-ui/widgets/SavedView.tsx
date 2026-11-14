import { useSavedView } from '@app/features/saved-views/queries/saved-views';
import { TaskList } from '@app/features/tasks-view/components/task-list/TaskList';
import {
  materializeTaskSavedView,
  readTaskSavedView,
} from '@app/features/tasks-view/filters/task-saved-view';
import { TasksViewProvider } from '@app/features/tasks-view/tasks-view-context';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import { cn } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { WidgetOf } from '../view';
import {
  DataPane,
  NoAccess,
  Pane,
  PaneLoading,
  PaneMessage,
  usePaneDense,
} from './panes/pane';

export type SavedViewProps = Omit<WidgetOf<'savedView'>, 'type'>;

/** Whether a saved view's definition is a task list's. */
function isTaskDefinition(config: unknown): boolean {
  return (
    typeof config === 'object' &&
    config !== null &&
    'kind' in config &&
    config.kind === 'tasks'
  );
}

/**
 * The tasks a saved view matches, in the Tasks list with its filters,
 * grouping and sort, read live as the viewer: "Me" in its filters is
 * whoever opens the pane. Opening a task opens it beside the view.
 */
export function SavedView(props: SavedViewProps) {
  const dense = usePaneDense(() => props.dense);
  return (
    <DataPane
      type="savedView"
      dense={dense()}
      attributes={{ 'saved_view.id': props.viewId }}
    >
      <Definition {...props} dense={dense()} />
    </DataPane>
  );
}

function Definition(props: SavedViewProps & { dense: boolean }) {
  const viewerId = useUserId();
  const saved = useSavedView({ viewerId, id: () => props.viewId });
  usePending('dynamic_ui.pane.load', () => saved.loading());
  const title = () => props.title ?? saved.data()?.name;
  return (
    <Pane
      title={title()}
      label={title() ?? t('dynamicUi.savedView')}
      dense={props.dense}
    >
      <Switch fallback={<PaneLoading dense={props.dense} />}>
        <Match when={saved.data() === null}>
          <NoAccess dense={props.dense} />
        </Match>
        <Match when={saved.error() && saved.data() === undefined}>
          <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
        </Match>
        <Match when={saved.data()}>
          {(view) => (
            <Switch
              fallback={
                <PaneMessage dense={props.dense}>
                  {t('dynamicUi.unsupportedSavedView')}
                </PaneMessage>
              }
            >
              <Match when={isTaskDefinition(view().config)}>
                {/* The list takes the definition once; an edited view
                    remounts it with its new filters. */}
                <Show when={`${view().id}:${view().revision}`} keyed>
                  <Tasks
                    viewId={view().id}
                    config={view().config}
                    dense={props.dense}
                  />
                </Show>
              </Match>
            </Switch>
          )}
        </Match>
      </Switch>
    </Pane>
  );
}

function Tasks(props: { viewId: string; config: unknown; dense: boolean }) {
  const layout = useSplitLayout();
  // A pane shows the list layout whatever the view saved: a board or Gantt
  // needs a whole split.
  const initialState = () => ({
    ...materializeTaskSavedView(readTaskSavedView(props.config).config),
    layout: 'list' as const,
  });
  return (
    <div
      class={cn(
        'flex flex-none flex-col overflow-hidden',
        props.dense ? 'h-56' : 'h-72'
      )}
    >
      <ListEntityMetadataQueryProvider>
        <TagSetsQueryProvider>
          <TasksViewProvider
            initialState={initialState()}
            restoreEntryState={false}
            scopeKey={`dynamic-ui:saved-view:${props.viewId}`}
            onOpenTask={(task, options) => {
              layout.openWithSplit(
                { type: 'task', id: task.id },
                { preferNewSplit: options?.event?.shiftKey }
              );
              return true;
            }}
            onCloseTask={() => {}}
          >
            <TaskList
              emptyContent={
                <PaneMessage dense={props.dense}>
                  {t('dynamicUi.noTasks')}
                </PaneMessage>
              }
            />
          </TasksViewProvider>
        </TagSetsQueryProvider>
      </ListEntityMetadataQueryProvider>
    </div>
  );
}
