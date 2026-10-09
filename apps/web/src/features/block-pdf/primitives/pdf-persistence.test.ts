import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeUpdatePreparation } from '../../../lib/tauri/native-update-preparation';
import { createPdfPersistence, type PdfPersistence } from './pdf-persistence';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(): {
  persistence: PdfPersistence;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    persistence: createPdfPersistence(),
    dispose,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPdfPersistence', () => {
  it('prevents restart when a strict PDF save fails', async () => {
    const { persistence, dispose } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const flush = vi.fn();
    const preparation = createNativeUpdatePreparation({
      isBlocked: () => false,
      flush,
    });
    preparation.register(() =>
      persistence.runSave(
        async () => {
          throw new Error('PDF save failed');
        },
        () => true,
        { throwOnError: true }
      )
    );
    await expect(preparation.prepare()).rejects.toThrow('PDF save failed');
    expect(flush).not.toHaveBeenCalled();
    expect(persistence.isSaving()).toBe(false);
    dispose();
  });

  it('waits for an ongoing save before preparation can continue', async () => {
    const { persistence, dispose } = setup();
    const deferred = createDeferred();
    const saving = persistence.runSave(
      () => deferred.promise,
      () => true
    );
    const finished = vi.fn();
    const waiting = persistence.waitForSaves().then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    deferred.resolve();
    await Promise.all([saving, waiting]);
    expect(finished).toHaveBeenCalledOnce();
    dispose();
  });

  it('skips saves that are not required', async () => {
    const { persistence, dispose } = setup();
    let saves = 0;

    await persistence.runSave(
      async () => {
        saves += 1;
      },
      () => false
    );

    expect({ saves, isSaving: persistence.isSaving() }).toEqual({
      saves: 0,
      isSaving: false,
    });
    dispose();
  });

  it('tracks one save until it settles', async () => {
    const { persistence, dispose } = setup();
    const deferred = createDeferred();

    const saving = persistence.runSave(
      () => deferred.promise,
      () => true
    );
    expect(persistence.isSaving()).toBe(true);

    deferred.resolve();
    await saving;

    expect(persistence.isSaving()).toBe(false);
    dispose();
  });

  it('stays saving until two overlapping saves settle', async () => {
    const { persistence, dispose } = setup();
    const first = createDeferred();
    const second = createDeferred();

    const firstSaving = persistence.runSave(
      () => first.promise,
      () => true
    );
    const secondSaving = persistence.runSave(
      () => second.promise,
      () => true
    );
    expect(persistence.isSaving()).toBe(true);

    first.resolve();
    await firstSaving;
    expect(persistence.isSaving()).toBe(true);

    second.resolve();
    await secondSaving;
    expect(persistence.isSaving()).toBe(false);
    dispose();
  });

  it('logs rejected saves and clears saving state without rejecting', async () => {
    const { persistence, dispose } = setup();
    const error = new Error('save failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(
      persistence.runSave(
        async () => {
          throw error;
        },
        () => true
      )
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith('Error saving PDF', error);
    expect(persistence.isSaving()).toBe(false);
    dispose();
  });
});
