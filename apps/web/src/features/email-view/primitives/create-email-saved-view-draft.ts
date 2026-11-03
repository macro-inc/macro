import type { TagFacetContext } from '@app/features/soup';
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
import {
  captureEmailSavedView,
  decodeEmailSavedView,
  type EmailSavedViewIssue,
  type EmailSavedViewRead,
  emailSavedViewsEqual,
  type MaterializedEmailSavedView,
  materializeEmailSavedView,
  readEmailSavedView,
} from '../filters/email-saved-view';
import type { EmailViewState } from '../types';

export type EmailSavedViewSelection =
  | { kind: 'default' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | {
      kind: 'saved';
      record: SavedView;
      dirty: boolean;
      issues: EmailSavedViewIssue[];
    };

type ConfirmedEmailSavedView = EmailSavedViewRead & {
  record: SavedView;
  viewerId: string | undefined;
};

/** Keeps a view's confirmed definition apart from edits; the host owns navigation and writes. */
export function createEmailSavedViewDraft(options: {
  source: SavedViewSource;
  selectedId: Accessor<string | undefined>;
  viewerId: Accessor<string | undefined>;
  state: Pick<
    EmailViewState,
    'tab' | 'inboxIds' | 'aliasFilter' | 'facets' | 'conditions'
  >;
  facetContext: Accessor<TagFacetContext>;
  apply: (restored: MaterializedEmailSavedView) => void;
}) {
  const [confirmed, setConfirmed] = createSignal<ConfirmedEmailSavedView>();
  const [retainedDrafts, setRetainedDrafts] = createSignal<
    { id: string | undefined; viewerId: string | undefined }[]
  >([]);
  // A pending write keeps a later refresh from replacing the edits it is saving.
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
    captureEmailSavedView({
      tab: options.state.tab,
      inboxIds: options.state.inboxIds,
      aliasFilter: options.state.aliasFilter,
      facets: options.state.facets,
      conditions: options.state.conditions,
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
      baseline && (!definition || !emailSavedViewsEqual(baseline, definition))
    );
  };
  const install = (record: SavedView, parsed: EmailSavedViewRead) =>
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
          options.source.data(),
          options.source.error(),
          options.source.viewerId(),
          retainedDrafts(),
        ] as const,
      ([id, viewer, record, error, detailViewer]) => {
        if (!id || !viewer || error || !record || record.id !== id) return;
        if (detailViewer !== undefined && detailViewer !== viewer) return;
        latestRevision = Math.max(
          latestRevision,
          record.revision,
          confirmed()?.record.id === id
            ? (confirmed()?.record.revision ?? 0)
            : 0
        );
        if (record.revision < latestRevision) return;
        // Refreshes keep the viewer's edits; Reset restores the definition.
        if (
          confirmed()?.record.id === id &&
          (dirty() ||
            retainedDrafts().some(
              (draft) => draft.id === id && draft.viewerId === viewer
            ))
        )
          return;
        batch(() => {
          const parsed = readEmailSavedView(record.config);
          install(record, parsed);
          options.apply(materializeEmailSavedView(parsed.config));
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
  const view = createMemo<EmailSavedViewSelection>(() => {
    const id = options.selectedId();
    if (!id) return { kind: 'default' };
    const detailViewer = options.source.viewerId();
    if (
      (detailViewer === undefined || detailViewer === options.viewerId()) &&
      (options.source.error() || options.source.data() === null)
    )
      return { kind: 'unavailable' };
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

  /** Restores the confirmed definition, or a newer record for the same view. */
  const reset = (record?: SavedView) => {
    if (record) {
      if (record.id !== options.selectedId() || record.revision < revision())
        return;
      latestRevision = Math.max(latestRevision, record.revision);
      install(record, readEmailSavedView(record.config));
    }
    const baseline = confirmed()?.config;
    if (baseline) options.apply(materializeEmailSavedView(baseline));
  };

  // A write advances the baseline, never the settings the viewer is editing.
  const acceptConfirmed = (record: SavedView) => {
    const previous = confirmed();
    if (record.id === options.selectedId() && record.revision < revision())
      return false;
    if (
      previous?.record.id === record.id &&
      record.revision < previous.record.revision
    )
      return false;
    const decoded = decodeEmailSavedView(record.config);
    if (decoded.isOk()) {
      if (record.id === options.selectedId())
        latestRevision = Math.max(latestRevision, record.revision);
      install(record, { config: decoded.value, issues: [] });
      return true;
    }
    // A rename keeps skipped settings and their existing baseline.
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

export type EmailSavedViewDraft = ReturnType<typeof createEmailSavedViewDraft>;
