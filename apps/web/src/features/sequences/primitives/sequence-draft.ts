import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  Sequence,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { createSignal, onCleanup } from 'solid-js';
import type { SequenceSource } from '../context/sequences-context';
import type { SequenceFailure } from '../core/errors';
import { draftChanges, type SequenceDraft, toDraft } from '../core/sequence';

const SURFACE = 'sequences.autosave';
const AUTOSAVE_DELAY_MS = 800;

/** The saved sequence an edit started from, copied out of the query store. */
type Base = { version: number; saved: SequenceDraft };
type Edit = Base & { draft: SequenceDraft };

/**
 * A plain copy: the query store updates the sequence in place on a refetch, so
 * a live reference would carry the newer version into the edit.
 */
function snapshot(sequence: Sequence | undefined): Base | undefined {
  return sequence && { version: sequence.version, saved: toDraft(sequence) };
}

/**
 * Local edits over the copy they started from, saved shortly after each
 * change. A save sends only what changed, with that copy's version, so a
 * sequence changed elsewhere is refused instead of overwritten. Saves run one
 * at a time; edits made while one is in flight are sent next.
 */
export function createSequenceDraft(
  source: Pick<SequenceSource, 'sequence' | 'update'>
) {
  const [edit, setEdit] = createSignal<Edit>();
  const [failure, setFailure] = createSignal<SequenceFailure>();
  const [saving, setSaving] = createSignal(false);
  let inFlight: Promise<boolean> | undefined;
  const draft = (): SequenceDraft | undefined => {
    const current = edit();
    if (current) return current.draft;
    const sequence = source.sequence();
    return sequence && toDraft(sequence);
  };

  async function send(status?: SequenceStatus) {
    const base = edit() ?? snapshot(source.sequence());
    const sent = draft();
    if (!base || !sent) return false;
    const changes = draftChanges(base.saved, sent);
    if (!changes && !status) return true;
    setFailure(undefined);
    setSaving(true);
    const result = await source.update({
      version: base.version,
      ...changes,
      ...(status && { status }),
    });
    setSaving(false);
    if (result.isErr()) {
      setFailure(result.error);
      return false;
    }
    const saved = toDraft(result.value);
    const current = edit()?.draft;
    setEdit(
      current && draftChanges(saved, current)
        ? { version: result.value.version, saved, draft: current }
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
  // Leaving the editor saves what is left instead of dropping it.
  onCleanup(() => {
    autosave.clear();
    if (edit() && !failure()) fireAndForget(save(), SURFACE);
  });

  // An edit undone back to the saved copy is no edit.
  const change = (next: SequenceDraft) => {
    setFailure(undefined);
    setEdit((current) => {
      const base = current ?? snapshot(source.sequence());
      return base && draftChanges(base.saved, next)
        ? { version: base.version, saved: base.saved, draft: next }
        : undefined;
    });
    autosave();
  };
  const discard = () => {
    autosave.clear();
    setEdit(undefined);
    setFailure(undefined);
  };
  return {
    draft,
    change,
    discard,
    save,
    saving,
    failure,
    /** The sequence changed elsewhere since these edits began. */
    conflict: () => {
      const current = failure();
      return current?.kind === 'refused' && current.code === 'version_conflict';
    },
  };
}
