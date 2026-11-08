import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import type { SequenceStatus } from '@service-email/generated/schemas';
import { createSignal, onCleanup } from 'solid-js';
import type { SequenceSource } from '../context/sequences-context';
import type { SequenceFailure } from '../core/errors';
import { draftChanges, type SequenceDraft, toDraft } from '../core/sequence';

const SURFACE = 'sequences.autosave';
const AUTOSAVE_DELAY_MS = 800;

type Edit = { saved: SequenceDraft; draft: SequenceDraft };

/**
 * Local edits over the saved copy they started from, saved shortly after each
 * change. A save sends only the fields that changed, so it keeps a field
 * changed elsewhere since. Saves run one at a time; edits made while one is
 * in flight are sent next. A refused save keeps the edits and its failure
 * until the next change.
 */
export function createSequenceDraft(
  source: Pick<SequenceSource, 'sequence' | 'update'>
) {
  const [edit, setEdit] = createSignal<Edit>();
  const [failure, setFailure] = createSignal<SequenceFailure>();
  const [saving, setSaving] = createSignal(false);
  let inFlight: Promise<boolean> | undefined;
  const saved = () => {
    const current = edit();
    if (current) return current.saved;
    const sequence = source.sequence();
    return sequence && toDraft(sequence);
  };
  const draft = () => edit()?.draft ?? saved();

  async function send(status?: SequenceStatus) {
    const base = saved();
    const sent = draft();
    if (!base || !sent) return false;
    const changes = draftChanges(base, sent);
    if (!changes && !status) return true;
    setFailure(undefined);
    setSaving(true);
    const result = await source.update({
      ...changes,
      ...(status && { status }),
    });
    setSaving(false);
    if (result.isErr()) {
      setFailure(result.error);
      return false;
    }
    const next = toDraft(result.value);
    const current = edit()?.draft;
    setEdit(
      current && draftChanges(next, current)
        ? { saved: next, draft: current }
        : undefined
    );
    return true;
  }

  /** Saves the edits and, when given, moves to `status` in the same request. */
  async function save(status?: SequenceStatus): Promise<boolean> {
    autosave.clear();
    while (inFlight) await inFlight;
    inFlight = send(status);
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  }

  const autosave = debounce(
    () => fireAndForget(save(), SURFACE),
    AUTOSAVE_DELAY_MS
  );
  // Leaving the editor saves what is left; a refused draft would be refused again.
  onCleanup(() => {
    autosave.clear();
    if (edit() && failure()?.kind !== 'refused') fireAndForget(save(), SURFACE);
  });

  // An edit undone back to the saved copy is no edit.
  const change = (next: SequenceDraft) => {
    setFailure(undefined);
    const base = saved();
    setEdit(
      base && draftChanges(base, next)
        ? { saved: base, draft: next }
        : undefined
    );
    autosave();
  };
  return { draft, change, save, saving, failure };
}
