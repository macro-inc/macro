import type { Result } from 'neverthrow';
import { type Accessor, batch, createEffect, createMemo, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { SavedViewSource } from '../context/saved-views-source';
import type { SavedView } from '../core/saved-view';

export type SavedViewSelection<Issue> =
  | { kind: 'default'; changed: boolean }
  | { kind: 'new'; changed: boolean }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'saved'; record: SavedView; dirty: boolean; issues: Issue[] };

type Definition<Config, Issue> = { config: Config; issues: Issue[] };
type Confirmed<Config, Issue> = Definition<Config, Issue> & {
  record: SavedView;
  viewerId: string | undefined;
};
type RetainedDraft = {
  token: symbol;
  id: string | undefined;
  viewerId: string | undefined;
};

/** Reconciles confirmed definitions without replacing dirty or retained drafts. */
export function createSavedViewDraft<Config, Issue>(options: {
  source: SavedViewSource;
  selectedId: Accessor<string | undefined>;
  viewerId: Accessor<string | undefined>;
  creating: Accessor<boolean>;
  capture: () => Result<Config, string>;
  defaults: () => Result<Config, string>;
  read: (value: unknown) => Definition<Config, Issue>;
  decode: (value: unknown) => Result<Config, string>;
  equal: (left: Config, right: Config) => boolean;
  apply: (config: Config) => void;
  resetNew: () => void;
}) {
  const [state, setState] = createStore<{
    confirmed?: Confirmed<Config, Issue>;
    retained: RetainedDraft[];
    latest?: { record: SavedView };
  }>({ retained: [] });
  const retain = () => {
    const owner = {
      token: Symbol(),
      id: options.selectedId(),
      viewerId: options.viewerId(),
    };
    setState('retained', (drafts) => [...drafts, owner]);
    return () =>
      setState('retained', (drafts) =>
        drafts.filter((draft) => draft.token !== owner.token)
      );
  };
  const current = createMemo(() => {
    const result = options.capture();
    return result.isOk() ? result.value : undefined;
  });
  const dirty = () => {
    const baseline = state.confirmed?.config;
    const definition = current();
    return (
      baseline !== undefined &&
      (definition === undefined || !options.equal(baseline, definition))
    );
  };
  const install = (record: SavedView, parsed: Definition<Config, Issue>) =>
    setState('confirmed', { record, viewerId: options.viewerId(), ...parsed });

  // Read-source events are an external input. Only clean drafts adopt newer revisions.
  createEffect(
    on(
      () => [options.selectedId(), options.viewerId()] as const,
      ([id, viewer]) => {
        setState({ latest: undefined, retained: [] });
        const previous = state.confirmed;
        if (previous?.record.id !== id || previous?.viewerId !== viewer)
          setState('confirmed', undefined);
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
          state.retained,
        ] as const,
      ([id, viewer, creating, record, error, detailViewer]) => {
        if (!id || !viewer || creating || error || !record || record.id !== id)
          return;
        if (detailViewer !== undefined && detailViewer !== viewer) return;
        const localRevision =
          state.confirmed?.record.id === id
            ? state.confirmed.record.revision
            : 0;
        const latestRevision = Math.max(
          state.latest?.record.revision ?? 0,
          localRevision
        );
        if (record.revision < latestRevision) return;
        // Retain the definition, not only its revision: a later source emission
        // can be older, but Reset must still restore the newest observed data.
        setState('latest', { record });
        const retained = state.retained.some(
          (draft) => draft.id === id && draft.viewerId === viewer
        );
        if (state.confirmed?.record.id === id && (dirty() || retained)) return;
        batch(() => {
          const parsed = options.read(record.config);
          install(record, parsed);
          options.apply(parsed.config);
        });
      }
    )
  );
  const revision = () => {
    const id = options.selectedId();
    const local = state.confirmed?.record;
    const latest = state.latest?.record;
    return Math.max(
      local && local.id === id ? local.revision : 0,
      latest && latest.id === id ? latest.revision : 0
    );
  };
  const view = createMemo<SavedViewSelection<Issue>>(() => {
    const id = options.selectedId();
    if (options.creating() || !id) {
      const base = options.defaults();
      const definition = current();
      return {
        kind: options.creating() ? 'new' : 'default',
        changed:
          definition !== undefined &&
          base.isOk() &&
          !options.equal(definition, base.value),
      };
    }
    const detailViewer = options.source.viewerId();
    const currentViewer =
      detailViewer === undefined || detailViewer === options.viewerId();
    if (
      currentViewer &&
      (options.source.error() || options.source.data() === null)
    )
      return {
        kind: 'unavailable',
        message: 'This saved view is unavailable or you no longer have access.',
      };
    const snapshot = state.confirmed;
    if (options.viewerId() && snapshot?.record.id === id)
      return {
        kind: 'saved',
        record: snapshot.record,
        dirty: dirty(),
        issues: snapshot.issues,
      };
    return { kind: 'loading' };
  });
  const reset = (record?: SavedView) => {
    const latest = state.latest?.record;
    // Explicit Reset discards local edits, including when source reconciliation
    // retained a newer authorized definition while editing.
    const candidate =
      record ?? (latest && latest.revision >= revision() ? latest : undefined);
    batch(() => {
      if (candidate) {
        if (
          candidate.id !== options.selectedId() ||
          candidate.revision < revision()
        )
          return;
        install(candidate, options.read(candidate.config));
      }
      if (options.creating()) return options.resetNew();
      const baseline = state.confirmed?.config;
      if (baseline !== undefined) options.apply(baseline);
    });
  };
  const acceptConfirmed = (record: SavedView) => {
    if (record.id !== options.selectedId()) return false;
    const previous = state.confirmed;
    if (record.id === options.selectedId() && record.revision < revision())
      return false;
    if (
      previous?.record.id === record.id &&
      record.revision < previous.record.revision
    )
      return false;
    const decoded = options.decode(record.config);
    if (decoded.isOk()) {
      install(record, { config: decoded.value, issues: [] });
      return true;
    }
    // Metadata writes preserve skipped conditions and their confirmed baseline.
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
    capture: options.capture,
    revision,
    reset,
    acceptConfirmed,
    retain,
    confirmed: () => state.confirmed,
  };
}
