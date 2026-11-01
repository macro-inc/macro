import type {
  Sequence,
  UpdateSequenceRequest,
} from '@service-email/generated/schemas';
import { err, ok, type Result } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceFailure } from '../core/errors';
import { createSequenceDraft } from './sequence-draft';

const SEQUENCE: Sequence = {
  id: 'sequence',
  name: 'Intro',
  linkId: 'link',
  footer: '',
  status: 'draft',
  steps: [{ delayDays: 0, subject: 'Hello', body: 'Hi', asReply: false }],
  version: 3,
  createdAt: '',
  updatedAt: '',
};

function setup(answer?: SequenceFailure) {
  const [sequence, setSequence] = createSignal<Sequence | undefined>(SEQUENCE);
  const update = vi.fn(
    async (
      request: UpdateSequenceRequest
    ): Promise<Result<Sequence, SequenceFailure>> =>
      answer ? err(answer) : ok({ ...SEQUENCE, version: request.version + 1 })
  );
  const draft = createRoot(() => createSequenceDraft({ sequence, update }));
  return { draft, update, setSequence };
}

describe('createSequenceDraft', () => {
  it('mirrors the saved sequence until edited, and an undone edit is no edit', () => {
    const { draft } = setup();
    expect(draft.draft()?.name).toBe('Intro');
    expect(draft.changed()).toBe(false);

    draft.change({ ...draft.draft()!, name: 'Renamed' });
    expect(draft.changed()).toBe(true);

    draft.change({ ...draft.draft()!, name: 'Intro' });
    expect(draft.changed()).toBe(false);
  });

  it('saves only what changed, with the version the edit started from', async () => {
    const { draft, update, setSequence } = setup();
    draft.change({ ...draft.draft()!, footer: 'Acme' });
    // A refetch lands mid-edit; the edit keeps its base.
    setSequence({ ...SEQUENCE, name: 'Changed elsewhere', version: 4 });

    expect(await draft.save('active')).toBe(true);
    expect(update).toHaveBeenCalledWith({
      version: 3,
      footer: 'Acme',
      status: 'active',
    });
    expect(draft.changed()).toBe(false);
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

  it('reports other failures without calling them a conflict', async () => {
    const { draft } = setup({ kind: 'unavailable' });
    draft.change({ ...draft.draft()!, name: 'Mine' });

    expect(await draft.save()).toBe(false);
    expect(draft.failure()).toEqual({ kind: 'unavailable' });
    expect(draft.conflict()).toBe(false);
    expect(draft.changed()).toBe(true);
  });
});
