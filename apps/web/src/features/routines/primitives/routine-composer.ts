import { debounce } from '@solid-primitives/scheduled';
import { createSignal, onCleanup } from 'solid-js';
import type {
  RoutineCreatorSource,
  RoutineDraftStorage,
} from '../context/routine-sources';
import type { ScheduleDraft } from '../core/draft';
import {
  createEmptyDraft,
  getErrorMessage,
  validateRoutineDraft,
} from '../core/routine-draft';

export function createRoutineComposer(
  source: RoutineCreatorSource,
  storage: RoutineDraftStorage,
  defaultModel: string,
  onCreated: (id: string) => void
) {
  const restored = storage.load();
  const [draft, setDraft] = createSignal<ScheduleDraft>(
    restored
      ? {
          ...restored,
          triggers: restored.triggers ?? [],
          enabled: restored.enabled ?? true,
        }
      : { ...createEmptyDraft(defaultModel), triggers: [], enabled: true }
  );
  const [attempted, setAttempted] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string>();
  const save = debounce((value: ScheduleDraft) => storage.save(value), 300);
  let dirty = false;
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
    if (dirty) storage.save(draft());
  });
  async function create() {
    if (source.pending()) return;
    setAttempted(true);
    if (validateRoutineDraft(draft(), true)) return;
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
  return { draft, change, attempted, submitError, create };
}
