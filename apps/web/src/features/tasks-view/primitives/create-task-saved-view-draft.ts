import { type Accessor, createMemo } from 'solid-js';
import type { SavedViewSource } from '../../saved-views/context/saved-views-source';
import {
  createSavedViewDraft,
  type SavedViewSelection,
} from '../../saved-views/primitives/create-saved-view-draft';
import { TASK_DEFAULT_GROUP_BY } from '../constants';
import {
  DEFAULT_TASK_FACET_SELECTION,
  type TaskFacetContext,
} from '../filters/task-facets';
import {
  captureTaskSavedView,
  decodeTaskSavedView,
  materializeTaskSavedView,
  readTaskSavedView,
  type TaskSavedViewIssue,
  taskSavedViewsEqual,
} from '../filters/task-saved-view';
import type { TasksViewState } from '../types';

export type TaskSavedViewSelection = SavedViewSelection<TaskSavedViewIssue>;

export function taskSavedViewTitle(view: TaskSavedViewSelection): string {
  if (view.kind === 'saved') return view.record.name;
  return view.kind === 'new' ? 'New view' : 'Saved view';
}

/** Task-specific encoding; confirmed revision and draft ownership are shared. */
export function createTaskSavedViewDraft(options: {
  source: SavedViewSource;
  selectedId: Accessor<string | undefined>;
  viewerId: Accessor<string | undefined>;
  creating: Accessor<boolean>;
  state: Pick<
    TasksViewState,
    'tab' | 'facets' | 'layout' | 'groupBy' | 'sort' | 'dueDate'
  >;
  facetContext: Accessor<TaskFacetContext>;
  apply: (
    settings: Pick<
      TasksViewState,
      'facets' | 'layout' | 'groupBy' | 'sort' | 'dueDate'
    >
  ) => void;
}) {
  const draft = createSavedViewDraft({
    ...options,
    capture: () =>
      captureTaskSavedView({
        ...options.state,
        context: options.facetContext(),
      }),
    defaults: () =>
      captureTaskSavedView({
        tab: options.state.tab,
        facets: DEFAULT_TASK_FACET_SELECTION,
        groupBy: TASK_DEFAULT_GROUP_BY[options.state.tab],
        dueDate: undefined,
        context: options.facetContext(),
      }),
    read: readTaskSavedView,
    decode: decodeTaskSavedView,
    equal: taskSavedViewsEqual,
    apply: (config) => options.apply(materializeTaskSavedView(config)),
    resetNew: () =>
      options.apply({
        facets: DEFAULT_TASK_FACET_SELECTION,
        layout: 'list',
        groupBy: TASK_DEFAULT_GROUP_BY['team-tasks'],
        sort: [{ id: 'updated_at' }],
        dueDate: undefined,
      }),
  });
  const tagBindings = createMemo<ReadonlyMap<string, string>>(
    () =>
      new Map(
        draft
          .confirmed()
          ?.config.filters.tags.map((tag) => [
            tag.optionId,
            tag.propertyDefinitionId,
          ])
      )
  );
  return { ...draft, tagBindings };
}

export type TaskSavedViewDraft = ReturnType<typeof createTaskSavedViewDraft>;
