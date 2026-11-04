import type {
  Sequence,
  UpdateSequenceRequest,
} from '@service-email/generated/schemas';
import { err, ok, type Result } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SequenceFailure } from '../core/errors';
import { createSequenceDraft } from './sequence-draft';

const SEQUENCE: Sequence = {
  id: 'sequence',
  name: 'Intro',
  linkId: 'link',
  footer: '',
  weekdaysOnly: true,
  status: 'draft',
  steps: [{ delayDays: 0, subject: 'Hello', body: 'Hi', asReply: false }],
  version: 3,
  createdAt: '',
  updatedAt: '',
};

function setup(answer?: SequenceFailure) {
  const [sequence] = createSignal<Sequence | undefined>(SEQUENCE);
  const update = vi.fn(
    async (
      request: UpdateSequenceRequest
    ): Promise<Result<Sequence, SequenceFailure>> =>
      answer ? err(answer) : ok({ ...SEQUENCE, version: request.version + 1 })
  );
  return {
    draft: createRoot(() => createSequenceDraft({ sequence, update })),
    update,
  };
}

describe('createSequenceDraft', () => {
  it('keeps its version when a refetch updates the cached sequence in place', async () => {
    // Solid Query keeps data in a store and reconciles refetches into it by id.
    const [query, setQuery] = createStore<{ data?: Sequence }>({
      data: structuredClone(SEQUENCE),
    });
    const update = vi.fn(
      async (
        request: UpdateSequenceRequest
      ): Promise<Result<Sequence, SequenceFailure>> =>
        ok({ ...SEQUENCE, version: request.version + 1 })
    );
    const draft = createRoot(() =>
      createSequenceDraft({ sequence: () => query.data, update })
    );
    const before = query.data;
    draft.change({ ...draft.draft()!, footer: 'Acme' });

    setQuery(
      'data',
      reconcile(
        { ...SEQUENCE, name: 'Changed elsewhere', version: 4 },
        { key: 'id' }
      )
    );
    expect(query.data).toBe(before);
    expect(query.data?.version).toBe(4);

    expect(await draft.save()).toBe(true);
    expect(update).toHaveBeenCalledWith({ version: 3, footer: 'Acme' });
  });

  it('keeps the edits and reports a conflict when the sequence changed elsewhere', async () => {
    const { draft } = setup({ kind: 'refused', code: 'version_conflict' });
    draft.change({ ...draft.draft()!, name: 'Mine' });

    expect(await draft.save()).toBe(false);
    expect(draft.conflict()).toBe(true);
    expect(draft.draft()?.name).toBe('Mine');

    draft.discard();
    expect(draft.conflict()).toBe(false);
    expect(draft.draft()?.name).toBe('Intro');
  });

  describe('autosave', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('saves once after edits pause', async () => {
      vi.useFakeTimers();
      const { draft, update } = setup();
      draft.change({ ...draft.draft()!, name: 'Int' });
      draft.change({ ...draft.draft()!, name: 'Intro to Macro' });

      await vi.advanceTimersByTimeAsync(799);
      expect(update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        version: 3,
        name: 'Intro to Macro',
      });
    });

    it('keeps edits made during a save and sends them over the new version', async () => {
      vi.useFakeTimers();
      // Like the query cache, the source takes each saved sequence.
      const [sequence, setSequence] = createSignal<Sequence | undefined>(
        SEQUENCE
      );
      const saved = (next: Sequence) => {
        setSequence(next);
        return ok<Sequence, SequenceFailure>(next);
      };
      let finishFirst!: (result: Result<Sequence, SequenceFailure>) => void;
      const update = vi
        .fn<
          (
            request: UpdateSequenceRequest
          ) => Promise<Result<Sequence, SequenceFailure>>
        >()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishFirst = resolve;
            })
        )
        .mockImplementation(async (request) =>
          saved({ ...SEQUENCE, footer: 'AB', version: request.version + 1 })
        );
      const draft = createRoot(() => createSequenceDraft({ sequence, update }));

      draft.change({ ...draft.draft()!, footer: 'A' });
      await vi.advanceTimersByTimeAsync(800);
      expect(update).toHaveBeenCalledWith({ version: 3, footer: 'A' });

      draft.change({ ...draft.draft()!, footer: 'AB' });
      finishFirst(saved({ ...SEQUENCE, footer: 'A', version: 4 }));
      await vi.advanceTimersByTimeAsync(800);

      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith({ version: 4, footer: 'AB' });
      expect(draft.draft()?.footer).toBe('AB');
    });
  });
});
