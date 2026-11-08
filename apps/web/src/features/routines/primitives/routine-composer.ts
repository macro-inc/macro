import { COMPOSER_STORAGE_CLEARED } from '@core/auth/clear-composer-storage';
import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type {
  RoutineCreatorSource,
  RoutineDraftStorage,
} from '../context/routine-sources';
import type { ScheduleDraft } from '../core/draft';
import {
  createEmptyDraft,
  getErrorMessage,
  validateRoutineApps,
  validateRoutineDraft,
} from '../core/routine-draft';

export function createRoutineComposer(
  source: RoutineCreatorSource,
  storage: RoutineDraftStorage,
  defaultModel: string,
  onCreated: (id: string) => void,
  connectedApps: Accessor<ReadonlySet<string> | undefined>
) {
  const restored = storage.load();
  const [draft, setDraft] = createSignal<ScheduleDraft>(
    restored
      ? {
          ...restored,
          triggers: restored.triggers ?? [],
          enabled: restored.enabled ?? true,
        }
      : // As Start fresh leaves it: no trigger and no steps yet.
        {
          ...createEmptyDraft(defaultModel),
          triggers: [],
          steps: [],
          enabled: true,
        }
  );
  const [attempted, setAttempted] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string>();
  const formError = () =>
    validateRoutineDraft(draft(), true) ??
    validateRoutineApps(draft().apps, connectedApps());
  // Logging out clears drafts; this one must not write itself back after.
  let retired = false;
  const persist = (value: ScheduleDraft) => {
    if (!retired) storage.save(value);
  };
  const save = debounce(persist, 300);
  let dirty = false;
  const retire = () => {
    retired = true;
    save.clear();
    dirty = false;
  };
  window.addEventListener(COMPOSER_STORAGE_CLEARED, retire);
  onCleanup(() => window.removeEventListener(COMPOSER_STORAGE_CLEARED, retire));
  function change(update: (draft: ScheduleDraft) => ScheduleDraft) {
    if (source.pending()) return;
    const next = update(draft());
    if (next === draft()) return;
    setDraft(next);
    dirty = true;
    setSubmitError(undefined);
    save(next);
  }
  onCleanup(() => {
    save.clear();
    if (dirty) persist(draft());
  });
  /** Drop the draft, e.g. on Cancel, so it isn't offered again. */
  function discard() {
    save.clear();
    dirty = false;
    storage.clear();
  }
  async function create() {
    if (source.pending()) return;
    setAttempted(true);
    if (formError()) return;
    let id: string;
    try {
      id = await source.create(draft());
    } catch (error) {
      setSubmitError(getErrorMessage(error));
      return;
    }
    save.clear();
    dirty = false;
    storage.clear();
    onCreated(id);
  }
  return {
    draft,
    change,
    attempted,
    formError,
    submitError,
    create,
    discard,
  };
}
