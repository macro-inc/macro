import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoutineDraftStorage } from '../context/routine-sources';
import { createEmptyDraft } from '../core/routine-draft';
import { createRoutineComposer } from './routine-composer';

const draft = {
  ...createEmptyDraft('claude-sonnet-4-6'),
  prompt: 'Review new tasks',
  enabled: false,
  triggers: [
    { id: 'tasks', kind: 'event' as const, events: ['task.created' as const] },
  ],
};

let dispose = () => {};
afterEach(() => dispose());

function setup(create: () => Promise<string>) {
  const storage: RoutineDraftStorage = {
    load: () => draft,
    save: vi.fn(),
    clear: vi.fn(),
  };
  const onCreated = vi.fn();
  const [pending, setPending] = createSignal(false);
  const source = {
    pending,
    create: vi.fn(async () => {
      setPending(true);
      try {
        return await create();
      } finally {
        setPending(false);
      }
    }),
  };
  const composer = createRoot((cleanup) => {
    dispose = cleanup;
    return createRoutineComposer(source, storage, 'default-model', onCreated);
  });
  return { composer, storage, onCreated, source };
}

describe('routine creation state without app providers', () => {
  it('retains a failed draft and clears storage only after a successful retry', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce('routine-id');
    const { composer, storage, onCreated } = setup(create);
    composer.change((current) => ({ ...current, name: 'Task review' }));
    await composer.create();
    expect(composer.submitError()).toBe('Unavailable');
    expect(storage.clear).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(composer.draft().name).toBe('Task review');
    await composer.create();
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('routine-id');
    dispose();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects a duplicate submit and edits while the create request is pending', async () => {
    let resolve!: (id: string) => void;
    const { composer, source, onCreated } = setup(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const request = composer.create();
    await composer.create();
    composer.change((current) => ({ ...current, prompt: 'Changed' }));
    expect(source.create).toHaveBeenCalledOnce();
    expect(composer.draft().prompt).toBe(draft.prompt);
    resolve('created');
    await request;
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('created');
  });

  it('keeps an incomplete trigger in the draft without sending it to the server', async () => {
    const { composer, source, storage } = setup(async () => 'created');
    composer.change((current) => ({ ...current, triggers: [] }));
    await composer.create();
    expect(composer.attempted()).toBe(true);
    expect(source.create).not.toHaveBeenCalled();
    dispose();
    expect(storage.save).toHaveBeenCalledWith(
      expect.objectContaining({ triggers: [] })
    );
  });
});
