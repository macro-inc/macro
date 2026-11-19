import { deepEqual } from '@core/util/compareUtils';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import { v4 as uuid } from 'uuid';
import {
  appendSavedViewDraft,
  type NewSavedView,
  type SavedView,
} from '../core/saved-view';

export type { NewSavedView } from '../core/saved-view';

/** New definitions have their own identity; they never borrow the selected record. */
export function createSavedViewCreation(options: {
  kind: string;
  viewerId: Accessor<string | undefined>;
  capture: () => unknown;
  list: Accessor<readonly SavedView[] | undefined>;
  equal: (left: unknown, right: unknown) => boolean;
  confirmed?: () => void;
}) {
  const [state, setState] = createStore<{
    draft?: NewSavedView;
    baseline?: { config: unknown; name: string };
    changed: boolean;
    confirmed?: SavedView;
    persisted?: SavedView;
    saving: boolean;
  }>({ changed: false, saving: false });
  let navigate = (action: () => void) => action();
  let persist: ((draft: NewSavedView) => Promise<SavedView>) | undefined;
  let alive = true;
  let internalNavigation = false;
  let generation = 0;
  onCleanup(() => {
    alive = false;
  });
  createEffect(
    on(
      options.viewerId,
      () => {
        generation += 1;
        setState({
          draft: undefined,
          baseline: undefined,
          changed: false,
          confirmed: undefined,
          persisted: undefined,
        });
      },
      { defer: true }
    )
  );
  createEffect(
    on(options.list, (records) => {
      if (records?.some((record) => record.id === state.confirmed?.id))
        setState('confirmed', undefined);
    })
  );
  const current = () => state.draft;
  const begin = (
    config: unknown,
    name: string,
    changed = false,
    appearance?: NewSavedView['appearance']
  ) => {
    const draft: NewSavedView = {
      id: uuid(),
      kind: options.kind,
      config,
      name,
      sharedTeamId: null,
      appearance: structuredClone(unwrap(appearance)),
    };
    setState({
      draft,
      baseline: { config, name },
      changed,
      persisted: undefined,
    });
    return draft;
  };
  const discard = () =>
    setState({
      draft: undefined,
      baseline: undefined,
      changed: false,
      persisted: undefined,
    });
  const dirty = () => {
    const draft = current();
    const baseline = state.baseline;
    if (!draft || !baseline) return false;
    return (
      state.changed ||
      draft.name !== baseline.name ||
      draft.sharedTeamId !== null ||
      !options.equal(options.capture(), baseline.config)
    );
  };
  const update = (
    patch: Partial<Pick<NewSavedView, 'name' | 'sharedTeamId' | 'config'>>
  ) => {
    if (state.draft) setState('draft', patch);
  };
  const confirm = (record: SavedView) => {
    const draft = state.draft;
    if (!draft || draft.id !== record.id) return false;
    setState(
      'confirmed',
      options.list()?.some((item) => item.id === record.id) ? undefined : record
    );
    const matches =
      draft.name.trim() === record.name &&
      draft.sharedTeamId === record.sharedTeamId &&
      deepEqual(draft.appearance ?? null, record.appearance ?? null) &&
      options.equal(options.capture(), record.config);
    if (!matches) {
      // The first write succeeded, but newer edits still belong to this draft.
      // Retry updates that newly-created record rather than replaying creation.
      setState({ persisted: record, changed: true });
      return false;
    }
    discard();
    options.confirmed?.();
    return true;
  };
  const save = async () => {
    const draft = current();
    if (!draft || !persist || state.saving) return;
    const viewer = options.viewerId();
    const requestGeneration = generation;
    const snapshot = { ...draft, config: options.capture() };
    setState('saving', true);
    try {
      const record = await persist(snapshot);
      if (
        alive &&
        generation === requestGeneration &&
        viewer === options.viewerId() &&
        current()?.id === draft.id
      )
        confirm(record);
    } finally {
      if (alive) setState('saving', false);
    }
  };
  const items = () => {
    const records = options.list();
    const confirmed = state.confirmed;
    if (!confirmed || records?.some((record) => record.id === confirmed.id))
      return records;
    // The server appends creations too. Keep a confirmed write visible until its list arrives.
    if (confirmed.ownerId !== options.viewerId()) return records;
    return [...(records ?? []), confirmed];
  };
  const entries = createMemo(() =>
    appendSavedViewDraft(items() ?? [], current())
  );
  return {
    current,
    begin,
    discard,
    dirty,
    update,
    confirm,
    save,
    items,
    entries,
    saving: () => state.saving,
    persisted: () => state.persisted,
    viewerId: options.viewerId,
    isInternalNavigation: () => internalNavigation,
    internalNavigation: <T>(action: () => T): T => {
      internalNavigation = true;
      try {
        return action();
      } finally {
        internalNavigation = false;
      }
    },
    run: (action: () => void) => navigate(action),
    register: (run: (action: () => void) => void) => {
      navigate = run;
      return () => {
        if (navigate === run) navigate = (action) => action();
      };
    },
    registerSave: (save: (draft: NewSavedView) => Promise<SavedView>) => {
      persist = save;
      return () => {
        if (persist === save) persist = undefined;
      };
    },
  };
}

export type SavedViewCreation = ReturnType<typeof createSavedViewCreation>;
