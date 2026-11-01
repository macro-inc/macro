import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import type { SavedViewSource } from '../../saved-views/context/saved-views-source';
import type { SavedView } from '../../saved-views/core/saved-view';
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
  type TaskSavedViewConfig,
  type TaskSavedViewIssue,
  type TaskSavedViewRead,
  taskSavedViewsEqual,
} from '../filters/task-saved-view';
import type { TasksViewState } from '../types';

export type TaskSavedViewSelection =
  | { kind: 'default'; changed: boolean }
  | { kind: 'new'; changed: boolean }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | {
      kind: 'saved';
      record: SavedView;
      dirty: boolean;
      issues: TaskSavedViewIssue[];
    };

export function taskSavedViewTitle(view: TaskSavedViewSelection): string {
  if (view.kind === 'saved') return view.record.name;
  return view.kind === 'new' ? 'New view' : 'Saved view';
}

type ConfirmedTaskSavedView = TaskSavedViewRead & {
  record: SavedView;
  viewerId: string | undefined;
};

/** Keeps confirmed settings separate from edits; navigation and writes belong to the host. */
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
  const [confirmed, setConfirmed] = createSignal<ConfirmedTaskSavedView>();
  const [retainedDrafts, setRetainedDrafts] = createSignal<
    { id: string | undefined; viewerId: string | undefined }[]
  >([]);
  const retain = () => {
    const owner = { id: options.selectedId(), viewerId: options.viewerId() };
    setRetainedDrafts((drafts) => [...drafts, owner]);
    return () =>
      setRetainedDrafts((drafts) => drafts.filter((draft) => draft !== owner));
  };
  let latestRevision = 0;
  const tagBindings = createMemo<ReadonlyMap<string, string>>(
    () =>
      new Map(
        confirmed()?.config.filters.tags.map((tag) => [
          tag.optionId,
          tag.propertyDefinitionId,
        ])
      )
  );
  const capture = () =>
    captureTaskSavedView({
      tab: options.state.tab,
      facets: options.state.facets,
      layout: options.state.layout,
      groupBy: options.state.groupBy,
      sort: options.state.sort,
      dueDate: options.state.dueDate,
      context: options.facetContext(),
    });
  const current = createMemo(() => {
    const result = capture();
    return result.isOk() ? result.value : undefined;
  });
  const dirty = () => {
    const baseline = confirmed()?.config;
    const definition = current();
    return Boolean(
      baseline && (!definition || !taskSavedViewsEqual(baseline, definition))
    );
  };
  const apply = (config: TaskSavedViewConfig) =>
    options.apply(materializeTaskSavedView(config));
  const install = (record: SavedView, parsed: TaskSavedViewRead) =>
    setConfirmed({ record, viewerId: options.viewerId(), ...parsed });

  createEffect(
    on(
      () => [options.selectedId(), options.viewerId()] as const,
      ([id, viewer]) => {
        latestRevision = 0;
        setRetainedDrafts([]);
        const previous = confirmed();
        if (previous?.record.id !== id || previous?.viewerId !== viewer)
          setConfirmed(undefined);
      }
    )
  );
  createEffect(
    on(
      () =>
        [
          options.selectedId(),
          options.viewerId(),
          options.creating(),
          options.source.data(),
          options.source.error(),
          options.source.viewerId(),
          retainedDrafts(),
        ] as const,
      ([id, viewer, creating, record, error, detailViewer]) => {
        if (!id || !viewer || creating || error || !record || record.id !== id)
          return;
        if (detailViewer !== undefined && detailViewer !== viewer) return;
        latestRevision = Math.max(
          latestRevision,
          record.revision,
          confirmed()?.record.id === id
            ? (confirmed()?.record.revision ?? 0)
            : 0
        );
        if (record.revision < latestRevision) return;
        if (
          confirmed()?.record.id === id &&
          (dirty() ||
            retainedDrafts().some(
              (draft) => draft.id === id && draft.viewerId === viewer
            ))
        )
          return;
        batch(() => {
          const parsed = readTaskSavedView(record.config);
          install(record, parsed);
          apply(parsed.config);
        });
      }
    )
  );

  const revision = () => {
    const id = options.selectedId();
    const local = confirmed()?.record;
    const remote = options.source.data();
    return Math.max(
      latestRevision,
      local && local.id === id ? local.revision : 0,
      remote && remote.id === id ? remote.revision : 0
    );
  };
  const view = createMemo<TaskSavedViewSelection>(() => {
    const id = options.selectedId();
    if (options.creating() || !id) {
      const base = captureTaskSavedView({
        tab: options.state.tab,
        facets: DEFAULT_TASK_FACET_SELECTION,
        groupBy: TASK_DEFAULT_GROUP_BY[options.state.tab],
        dueDate: undefined,
        context: options.facetContext(),
      });
      const definition = current();
      return {
        kind: options.creating() ? 'new' : 'default',
        changed: Boolean(
          definition &&
            base.isOk() &&
            !taskSavedViewsEqual(definition, base.value)
        ),
      };
    }
    const detailViewer = options.source.viewerId();
    if (
      (detailViewer === undefined || detailViewer === options.viewerId()) &&
      (options.source.error() || options.source.data() === null)
    ) {
      return {
        kind: 'unavailable',
        message: 'This saved view is unavailable or you no longer have access.',
      };
    }
    const snapshot = confirmed();
    return options.viewerId() && snapshot?.record.id === id
      ? {
          kind: 'saved',
          record: snapshot.record,
          dirty: dirty(),
          issues: snapshot.issues,
        }
      : { kind: 'loading' };
  });
  const reset = (record?: SavedView) => {
    if (record) {
      if (record.id !== options.selectedId() || record.revision < revision())
        return;
      latestRevision = Math.max(latestRevision, record.revision);
      install(record, readTaskSavedView(record.config));
    }
    if (options.creating()) {
      options.apply({
        facets: DEFAULT_TASK_FACET_SELECTION,
        layout: 'list',
        groupBy: TASK_DEFAULT_GROUP_BY['team-tasks'],
        sort: [{ id: 'updated_at' }],
        dueDate: undefined,
      });
      return;
    }
    const baseline = confirmed()?.config;
    if (baseline) apply(baseline);
  };

  // A write advances the baseline, never the settings the viewer is currently editing.
  const acceptConfirmed = (record: SavedView) => {
    const previous = confirmed();
    if (record.id === options.selectedId() && record.revision < revision())
      return false;
    if (
      previous?.record.id === record.id &&
      record.revision < previous.record.revision
    )
      return false;
    const decoded = decodeTaskSavedView(record.config);
    if (decoded.isOk()) {
      if (record.id === options.selectedId())
        latestRevision = Math.max(latestRevision, record.revision);
      install(record, { config: decoded.value, issues: [] });
      return true;
    }
    // Rename/share retain skipped clauses and their existing filter baseline.
    if (
      previous?.record.id === record.id &&
      JSON.stringify(previous.record.config) === JSON.stringify(record.config)
    ) {
      install(record, { config: previous.config, issues: previous.issues });
      return true;
    }
    return false;
  };

  return {
    view,
    tagBindings,
    capture,
    revision,
    reset,
    acceptConfirmed,
    retain,
  };
}

export type TaskSavedViewDraft = ReturnType<typeof createTaskSavedViewDraft>;
