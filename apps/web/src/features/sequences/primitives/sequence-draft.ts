import type {
  Sequence,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { createSignal } from 'solid-js';
import type { SequenceSource } from '../context/sequences-context';
import type { SequenceFailure } from '../core/errors';
import { draftChanges, type SequenceDraft, toDraft } from '../core/sequence';

type Edit = { base: Sequence; draft: SequenceDraft };

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
      const base = current?.base ?? source.sequence();
      return base && draftChanges(base, next)
        ? { base, draft: next }
        : undefined;
    });
  };
  const discard = () => {
    setEdit(undefined);
    setFailure(undefined);
  };
  /** Saves the edits and, when given, moves to `status` in the same request. */
  const save = async (status?: SequenceStatus) => {
    const base = edit()?.base ?? source.sequence();
    const current = draft();
    if (!base || !current) return false;
    setFailure(undefined);
    const result = await source.update({
      version: base.version,
      ...draftChanges(base, current),
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
