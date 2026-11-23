import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeFeedbackSource } from '../tests/fake-source';
import { createResponseFeedback } from './create-response-feedback';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

function setup(initial?: Parameters<typeof createFakeFeedbackSource>[0]) {
  const fake = createFakeFeedbackSource(initial);
  const onFailure = vi.fn();
  const feedback = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createResponseFeedback(fake.source, onFailure);
  });
  return { ...fake, feedback, onFailure };
}

describe('createResponseFeedback', () => {
  it('shows a rating before the server answers and opens the note', async () => {
    const { feedback, writes } = setup();

    const done = feedback.rate('up');

    expect(feedback.rating()).toBe('up');
    expect(feedback.pending()).toBe(true);
    expect(feedback.noteDraft()).toEqual({ rating: 'up', note: '' });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.write).toEqual({
      kind: 'rate',
      rating: 'up',
      note: null,
    });

    writes[0]?.succeed();
    await done;
    expect(feedback.pending()).toBe(false);
    expect(feedback.rating()).toBe('up');
  });

  it('retracts when the current rating is clicked again', async () => {
    const { feedback, writes } = setup({
      rating: 'up',
      note: 'clear answer',
      updatedAt: 'then',
    });

    const done = feedback.rate('up');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.succeed();
    await done;

    expect(writes[0]?.write).toEqual({ kind: 'retract' });
    expect(feedback.rating()).toBeUndefined();
    expect(feedback.noteDraft()).toBeUndefined();
  });

  it('switches rating in one write with a new id, dropping the old note', async () => {
    const { feedback, writes } = setup();

    const first = feedback.rate('up');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.succeed();
    await first;
    const saved = feedback.saveNote('cites the doc');
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    writes[1]?.succeed();
    await saved;

    const second = feedback.rate('down');
    await vi.waitFor(() => expect(writes).toHaveLength(3));
    writes[2]?.succeed();
    await second;

    expect(writes[2]?.write).toEqual({
      kind: 'rate',
      rating: 'down',
      note: null,
    });
    expect(feedback.noteDraft()).toEqual({ rating: 'down', note: '' });
    expect(new Set(writes.map((write) => write.id)).size).toBe(3);
    expect(feedback.rating()).toBe('down');
    expect(feedback.note()).toBeNull();
  });

  it('keeps the note when the same rating is saved again', async () => {
    const { feedback, writes } = setup({
      rating: 'up',
      note: 'cites the doc',
      updatedAt: 'then',
    });

    feedback.openNote();
    expect(feedback.noteDraft()).toEqual({
      rating: 'up',
      note: 'cites the doc',
    });
    const saved = feedback.saveNote('cites the doc and the PR');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.succeed();
    await saved;

    expect(writes[0]?.write).toEqual({
      kind: 'rate',
      rating: 'up',
      note: 'cites the doc and the PR',
    });
  });

  it('rolls back a refused write and reports it', async () => {
    const { feedback, writes, onFailure } = setup({
      rating: 'down',
      note: null,
      updatedAt: 'then',
    });

    const done = feedback.rate('up');
    expect(feedback.rating()).toBe('up');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.fail('forbidden');
    await done;

    expect(feedback.rating()).toBe('down');
    expect(feedback.pending()).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('forbidden');
  });

  it('reuses the id when the failed action is retried, and only then', async () => {
    const { feedback, writes } = setup();

    const failed = feedback.rate('up');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.fail();
    await failed;

    const retried = feedback.rate('up');
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    writes[1]?.fail();
    await retried;
    expect(writes[1]?.id).toBe(writes[0]?.id);

    const other = feedback.rate('down');
    await vi.waitFor(() => expect(writes).toHaveLength(3));
    writes[2]?.succeed();
    await other;
    expect(writes[2]?.id).not.toBe(writes[0]?.id);
  });

  it('sends a note saved during the rating after it, with that rating', async () => {
    const { feedback, writes } = setup();

    const rated = feedback.rate('down');
    const saved = feedback.saveNote('  wrong file  ');
    expect(feedback.noteDraft()).toBeUndefined();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.succeed();
    await rated;
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    writes[1]?.succeed();
    await saved;

    expect(writes[1]?.write).toEqual({
      kind: 'rate',
      rating: 'down',
      note: 'wrong file',
    });
    expect(feedback.note()).toBe('wrong file');
  });

  it('ignores clicks while a write is in flight', async () => {
    const { feedback, writes } = setup();

    const first = feedback.rate('up');
    await feedback.rate('down');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    writes[0]?.succeed();
    await first;

    expect(writes).toHaveLength(1);
    expect(feedback.rating()).toBe('up');
  });
});
