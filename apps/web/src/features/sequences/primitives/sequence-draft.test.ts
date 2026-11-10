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
  status: 'active',
  steps: [
    { id: 'a', delayDays: 0, subject: 'Hello', body: 'Hi', asReply: false },
  ],
  createdAt: '',
  updatedAt: '',
};

type Update = (
  request: UpdateSequenceRequest
) => Promise<Result<Sequence, SequenceFailure>>;

/** Like the update mutation, a saved sequence reaches the cache before the save resolves. */
function setup(
  answer: Update = async (request) =>
    ok({ ...SEQUENCE, ...request } as Sequence)
) {
  const [sequence, setSequence] = createSignal<Sequence | undefined>(SEQUENCE);
  const update = vi.fn<Update>(async (request) => {
    const result = await answer(request);
    if (result.isOk()) setSequence(result.value);
    return result;
  });
  let dispose!: () => void;
  const draft = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createSequenceDraft({ sequence, update });
  });
  return { draft, update, dispose };
}

describe('createSequenceDraft', () => {
  it('sends only its own changes when the cached sequence changes in place', async () => {
    // Solid Query keeps data in a store and reconciles refetches into it by id.
    const [query, setQuery] = createStore<{ data?: Sequence }>({
      data: structuredClone(SEQUENCE),
    });
    const update = vi.fn<Update>(async () => ok(SEQUENCE));
    const draft = createRoot(() =>
      createSequenceDraft({ sequence: () => query.data, update })
    );
    draft.change({ ...draft.draft()!, footer: 'Acme' });
    setQuery(
      'data',
      reconcile({ ...SEQUENCE, name: 'Changed elsewhere' }, { key: 'id' })
    );

    expect(await draft.save()).toBe(true);
    expect(update).toHaveBeenCalledWith({ footer: 'Acme' });
  });

  it('keeps a refused draft and its problem, and does not resend it on leaving', async () => {
    const refusal: SequenceFailure = {
      kind: 'refused',
      code: 'invalid_sequence',
      problem: 'subject_required',
      position: 1,
    };
    const { draft, update, dispose } = setup(async () => err(refusal));
    const emptied = draft.draft()!.steps.map((step) => ({
      ...step,
      subject: '',
    }));
    draft.change({ ...draft.draft()!, steps: emptied });

    expect(await draft.save()).toBe(false);
    expect(draft.failure()).toEqual(refusal);
    expect(draft.draft()?.steps[0]?.subject).toBe('');

    dispose();
    expect(update).toHaveBeenCalledTimes(1);
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
      expect(update).toHaveBeenCalledWith({ name: 'Intro to Macro' });
    });

    it('sends edits made during a save next, over what that save stored', async () => {
      vi.useFakeTimers();
      let finishFirst!: () => void;
      const { draft, update } = setup(async (request) => {
        if (request.footer === 'A')
          await new Promise<void>((resolve) => {
            finishFirst = resolve;
          });
        return ok({ ...SEQUENCE, ...request } as Sequence);
      });

      draft.change({ ...draft.draft()!, footer: 'A' });
      await vi.advanceTimersByTimeAsync(800);
      expect(update).toHaveBeenCalledWith({ footer: 'A' });

      draft.change({ ...draft.draft()!, footer: 'AB' });
      finishFirst();
      await vi.advanceTimersByTimeAsync(800);

      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith({ footer: 'AB' });
      expect(draft.draft()?.footer).toBe('AB');
    });
  });
});
