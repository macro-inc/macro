import type {
  Sequence,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { createSignal } from 'solid-js';
import type { SequenceSource } from '../context/sequences-context';
import type { SequenceFailure } from '../core/errors';
import { draftChanges, type SequenceDraft, toDraft } from '../core/sequence';

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
 * Local edits over the copy they started from. A save sends only what changed,
 * with that copy's version, so a sequence changed elsewhere is refused instead
 * of overwritten.
 */
export function createSequenceDraft(
  source: Pick<SequenceSource, 'sequence' | 'update'>
) {
  const [edit, setEdit] = createSignal<Edit>();
  const [failure, setFailure] = createSignal<SequenceFailure>();
  const draft = (): SequenceDraft | undefined => {
    const current = edit();
    if (current) return current.draft;
    const sequence = source.sequence();
    return sequence && toDraft(sequence);
  };
  // An edit undone back to the saved copy is no edit.
  const change = (next: SequenceDraft) => {
    setFailure(undefined);
    setEdit((current) => {
      const base = current ?? snapshot(source.sequence());
      return base && draftChanges(base.saved, next)
        ? { version: base.version, saved: base.saved, draft: next }
        : undefined;
    });
  };
  const discard = () => {
    setEdit(undefined);
    setFailure(undefined);
  };
  /** Saves the edits and, when given, moves to `status` in the same request. */
  const save = async (status?: SequenceStatus) => {
    const base = edit() ?? snapshot(source.sequence());
    const current = draft();
    if (!base || !current) return false;
    setFailure(undefined);
    const result = await source.update({
      version: base.version,
      ...draftChanges(base.saved, current),
      ...(status && { status }),
    });
    if (result.isErr()) {
      setFailure(result.error);
      return false;
    }
    setEdit(undefined);
    return true;
  };
  return {
    draft,
    changed: () => !!edit(),
    change,
    discard,
    save,
    failure,
    /** The sequence changed elsewhere since these edits began. */
    conflict: () => {
      const current = failure();
      return current?.kind === 'refused' && current.code === 'version_conflict';
    },
  };
}
