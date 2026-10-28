import { webcrypto } from 'node:crypto';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportUploadError } from '../context/contracts';
import type { ArchiveWorkerResponse } from '../core/worker-protocol';
import {
  createArchiveSource,
  protectImportFile,
} from '../queries/archive-source';
import {
  archiveDiscovery,
  deferred,
  fakeImportSources,
  historyPart,
  historySeal,
  importLimits,
  importReceipt,
} from '../tests/fake-sources';
import { createImportController } from './import-controller';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.unstubAllGlobals();
});

function setup() {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const sources = fakeImportSources();
    const controller = createImportController(sources);
    return { controller, sources, dispose };
  });
}
const selection = { selectedIds: ['C123'], sourceConfirmed: true };
async function select(
  controller: ReturnType<typeof createImportController>
): Promise<void> {
  await controller.discover(new Blob(['zip']));
}

describe('import controller', () => {
  it('reports prepared upload bytes including verified existing objects', async () => {
    const { controller, sources } = setup();
    const progress: ReturnType<typeof controller.uploadProgress>[] = [];
    sources.put.mockImplementation(async (blob, options) => {
      options?.onProgress?.({ kind: 'indeterminate', total: blob.size });
      progress.push(controller.uploadProgress());
      options?.onProgress?.({ kind: 'bytes', loaded: 1, total: blob.size });
      progress.push(controller.uploadProgress());
      return 'already-exists';
    });
    await select(controller);
    await controller.start(selection);
    expect(progress.some((value) => value.indeterminate)).toBe(true);
    expect(progress.some((value) => value.loaded > 0)).toBe(true);
    expect(controller.uploadProgress()).toEqual({
      loaded: 4,
      total: 4,
      indeterminate: false,
    });
  });

  it('does not upload during discovery or selection, and requires source confirmation', async () => {
    const { controller, sources } = setup();
    await select(controller);
    expect(controller.phase()).toBe('selecting');
    expect(sources.commands.create).not.toHaveBeenCalled();
    expect(sources.protectFile).toHaveBeenCalledTimes(1);
    expect(sources.release).toHaveBeenCalledTimes(1);
    await expect(
      controller.start({ ...selection, sourceConfirmed: false })
    ).rejects.toThrow('Confirm');
    expect(sources.commands.create).not.toHaveBeenCalled();
  });

  it('rejects workspace mismatches, unsupported DMs and duplicate selections', async () => {
    const { controller, sources } = setup();
    const found = archiveDiscovery();
    found.source = { kind: 'known', sourceId: 'T123' };
    found.conversations[0].kind = 'direct_message';
    sources.archive.discover.mockResolvedValue(found);
    await select(controller);
    sources.setBinding({ kind: 'known', sourceId: 'T456' });
    await expect(controller.start(selection)).rejects.toThrow(
      'different Slack workspace'
    );
    sources.setBinding({ kind: 'unbound' });
    expect(controller.skips()).toEqual([
      { slackChannelId: 'C123', reason: 'unsupported_dm' },
    ]);
    await expect(controller.start(selection)).rejects.toThrow('supported');
    await expect(
      controller.start({ ...selection, selectedIds: ['C123', 'C123'] })
    ).rejects.toThrow('supported');
    expect(sources.commands.create).not.toHaveBeenCalled();
  });

  it('rejects empty selection and cancels review without any network writes', async () => {
    const { controller, sources } = setup();
    await select(controller);
    await expect(
      controller.start({ ...selection, selectedIds: [] })
    ).rejects.toThrow('Select supported');
    await controller.cancel();
    expect(sources.newToken).not.toHaveBeenCalled();
    expect(sources.commands.create).not.toHaveBeenCalled();
    expect(sources.commands.cancel).not.toHaveBeenCalled();
    expect(sources.commands.register).not.toHaveBeenCalled();
    expect(sources.archive.dispose).toHaveBeenCalledOnce();
  });

  it('does not count unselected unsupported DMs as selected skips', async () => {
    const { controller, sources } = setup();
    const found = archiveDiscovery();
    found.conversations.push({
      ...found.conversations[0],
      slackChannelId: 'DB',
      kind: 'direct_message',
    });
    sources.archive.discover.mockResolvedValue(found);
    await select(controller);
    expect(controller.skips()).toHaveLength(1);
    await controller.start(selection);
    expect(controller.skips()).toEqual([]);
    expect(
      controller
        .job()
        ?.conversations.map((conversation) => conversation.slackChannelId)
    ).toEqual(['C123']);
  });

  it.each(['part', 'seal'] as const)(
    'rejects an unselected worker %s before registration/completion',
    async (kind) => {
      const { controller, sources } = setup();
      sources.archive.prepare.mockImplementation(async (options) => {
        if (kind === 'part')
          await options.part(
            {
              ...historyPart(),
              upload: {
                kind: 'conversation_part',
                slackChannelId: 'CB',
                partIndex: 0,
              },
            },
            new Blob(['[]'])
          );
        else await options.seal({ ...historySeal(0), slackChannelId: 'CB' });
      });
      await select(controller);
      await controller.start(selection);
      expect(controller.phase()).toBe('interrupted');
      expect(
        sources.commands.register.mock.calls.every((call) =>
          call[1].every((descriptor) => descriptor.upload.kind === 'users')
        )
      ).toBe(true);
      expect(sources.commands.complete).not.toHaveBeenCalled();
      expect(sources.commands.finalize).not.toHaveBeenCalled();
    }
  );

  it('creates once, seals the complete manifest, finalizes and monitors revisions', async () => {
    const { controller, sources } = setup();
    await select(controller);
    await Promise.all([
      controller.start(selection),
      controller.start(selection),
    ]);
    expect(sources.commands.create).toHaveBeenCalledTimes(1);
    expect(sources.commands.create.mock.calls[0][1]).toMatchObject({
      source: { kind: 'confirmed_unknown' },
      includeMessageHistory: true,
    });
    expect(sources.events.indexOf('seal:1')).toBeGreaterThan(
      sources.events.indexOf('complete:conversation_part')
    );
    expect(sources.events.at(-1)).toBe('finalize');
    expect(controller.phase()).toBe('monitoring');
    expect(sources.release).toHaveBeenCalledTimes(2);
    expect(sources.archive.dispose).toHaveBeenCalledTimes(1);
    sources.setObserved(importReceipt({ revision: 50, status: 'completed' }));
    expect(controller.phase()).toBe('terminal');
    sources.setObserved(importReceipt({ revision: 1, status: 'uploading' }));
    expect(controller.job()?.status).toBe('completed');
    expect(controller.phase()).toBe('terminal');
    sources.setObserved(
      importReceipt({ jobId: 'another', revision: 100, status: 'failed' })
    );
    expect(controller.job()?.jobId).toBe('job');
  });

  it.each([false, true])(
    'supports zero-part shape-only/empty history (history=%s)',
    async (includeMessageHistory) => {
      const { controller, sources } = setup();
      sources.archive.prepare.mockImplementation(async (options) => {
        await options.seal(historySeal(0));
      });
      await select(controller);
      await controller.start({ ...selection, includeMessageHistory });
      expect(
        sources.archive.prepare.mock.calls[0][0].includeMessageHistory
      ).toBe(includeMessageHistory);
      expect(sources.commands.register).toHaveBeenCalledTimes(1);
      expect(sources.commands.complete).toHaveBeenCalledWith(
        { teamId: 'team', jobId: 'job' },
        [],
        historySeal(0)
      );
      expect(sources.commands.finalize).toHaveBeenCalledTimes(1);
    }
  );

  it('waits for users-last readiness and keeps concurrency bounded to two lanes', async () => {
    const { controller, sources } = setup();
    const users = deferred<'uploaded'>();
    let active = 0;
    let maximum = 0;
    sources.put.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      if (sources.put.mock.calls.length === 1) await users.promise;
      active--;
      return 'uploaded';
    });
    sources.archive.prepare.mockImplementation(async (options) => {
      for (let index = 0; index < 4; index++)
        await options.part(historyPart(index), new Blob(['[]']));
      await options.seal(historySeal(4));
    });
    await select(controller);
    const running = controller.start(selection);
    await vi.waitFor(() => expect(sources.events).toContain('seal:4'));
    expect(sources.commands.finalize).not.toHaveBeenCalled();
    expect(sources.protectFile).toHaveBeenCalledTimes(2);
    expect(sources.release).toHaveBeenCalledTimes(1);
    expect(maximum).toBe(2);
    users.resolve('uploaded');
    await running;
    expect(sources.events.at(-2)).toBe('complete:users');
    expect(sources.commands.finalize).toHaveBeenCalledTimes(1);
  });

  it('deduplicates part and seal callbacks without changing a sealed manifest', async () => {
    const { controller, sources } = setup();
    sources.archive.prepare.mockImplementation(async (options) => {
      const descriptor = historyPart();
      await Promise.all([
        options.part(descriptor, new Blob(['[]'])),
        options.part(descriptor, new Blob(['[]'])),
      ]);
      await options.seal(historySeal());
      await options.seal(historySeal());
    });
    await select(controller);
    await controller.start(selection);
    expect(sources.commands.register).toHaveBeenCalledTimes(2);
    expect(sources.events.filter((event) => event === 'seal:1')).toHaveLength(
      1
    );
  });

  it.each(['missing', 'changed', 'after-seal'])(
    'rejects %s manifest data without silently finalizing',
    async (kind) => {
      const { controller, sources } = setup();
      sources.archive.prepare.mockImplementation(async (options) => {
        if (kind === 'missing') {
          await options.seal(historySeal(1));
          return;
        }
        await options.part(historyPart(), new Blob(['[]']));
        if (kind === 'changed')
          await options.part(
            { ...historyPart(), sha256: 'c'.repeat(64) },
            new Blob(['[]'])
          );
        else {
          await options.seal(historySeal());
          await options.part(historyPart(1), new Blob(['[]']));
        }
      });
      await select(controller);
      await controller.start(selection);
      expect(controller.phase()).toBe('interrupted');
      expect(sources.commands.finalize).not.toHaveBeenCalled();
      expect(sources.release).toHaveBeenCalledTimes(2);
      await controller.finalizeWithSkips();
      expect(sources.commands.finalize).toHaveBeenCalledTimes(1);
      expect(sources.commands.create).toHaveBeenCalledTimes(1);
    }
  );

  it('renews expired URLs just in time with exactly the same descriptor', async () => {
    const { controller, sources } = setup();
    sources.put.mockRejectedValueOnce(new ImportUploadError('EXPIRED'));
    const complete = sources.commands.complete.getMockImplementation()!;
    sources.commands.complete.mockImplementation(async (...args) => {
      if (
        args[1][0]?.kind === 'users' &&
        sources.commands.register.mock.calls.filter(
          (call) => call[1][0].upload.kind === 'users'
        ).length === 1
      )
        throw new Error('HEAD: not found');
      return complete(...args);
    });
    await select(controller);
    await controller.start(selection);
    const registrations = sources.commands.register.mock.calls.filter(
      (call) => call[1][0].upload.kind === 'users'
    );
    expect(registrations).toHaveLength(2);
    expect(registrations[0][1]).toEqual(registrations[1][1]);
    expect(sources.commands.create).toHaveBeenCalledTimes(1);
    expect(controller.phase()).toBe('monitoring');
  });

  it.each(['network', 'already-exists'])(
    'verifies HEAD after a %s PUT outcome',
    async (outcome) => {
      const { controller, sources } = setup();
      if (outcome === 'network')
        sources.put.mockRejectedValueOnce(
          new ImportUploadError('NETWORK_ERROR')
        );
      else sources.put.mockResolvedValueOnce('already-exists');
      await select(controller);
      await controller.start(selection);
      expect(sources.commands.register).toHaveBeenCalledTimes(2);
      expect(
        sources.commands.complete.mock.calls.filter(
          (call) => call[1][0]?.kind === 'users'
        )
      ).toHaveLength(1);
      expect(controller.phase()).toBe('monitoring');
    }
  );

  it('bounds failed PUT retries and allows cancellation after interruption', async () => {
    const { controller, sources } = setup();
    sources.archive.prepare.mockImplementation(async (options) => {
      await options.seal(historySeal(0));
    });
    sources.put.mockRejectedValue(new ImportUploadError('NETWORK_ERROR'));
    const complete = sources.commands.complete.getMockImplementation()!;
    sources.commands.complete.mockImplementation(async (...args) => {
      if (args[1].length) throw new Error('not found');
      return complete(...args);
    });
    await select(controller);
    await controller.start(selection);
    expect(sources.put).toHaveBeenCalledTimes(3);
    expect(controller.phase()).toBe('interrupted');
    expect(sources.commands.finalize).not.toHaveBeenCalled();
    expect(sources.release).toHaveBeenCalledTimes(2);
    await controller.cancel();
    expect(controller.phase()).toBe('terminal');
    expect(sources.commands.cancel).toHaveBeenCalledTimes(1);
  });

  it('recovers lost creation responses using the same request/token', async () => {
    const { controller, sources } = setup();
    sources.commands.create.mockRejectedValue(new Error('lost response'));
    await select(controller);
    await controller.start(selection);
    expect(controller.phase()).toBe('interrupted');
    expect(sources.commands.create).toHaveBeenCalledTimes(3);
    sources.commands.create.mockResolvedValue(importReceipt());
    await controller.recoverJob();
    await controller.finalizeWithSkips();
    const requests = sources.commands.create.mock.calls.map((call) => call[1]);
    expect(
      requests.every(
        (request) => JSON.stringify(request) === JSON.stringify(requests[0])
      )
    ).toBe(true);
    expect(sources.newToken).toHaveBeenCalledTimes(1);
    expect(sources.archive.prepare).not.toHaveBeenCalled();
  });

  it('cancels a delayed create before starting uploads', async () => {
    const { controller, sources } = setup();
    const created = deferred<ReturnType<typeof importReceipt>>();
    sources.commands.create.mockReturnValue(created.promise);
    await select(controller);
    const running = controller.start(selection);
    const cancelling = controller.cancel();
    created.resolve(importReceipt());
    await Promise.all([running, cancelling]);
    expect(sources.commands.cancel).toHaveBeenCalledWith({
      teamId: 'team',
      jobId: 'job',
    });
    expect(sources.commands.register).not.toHaveBeenCalled();
    expect(controller.phase()).toBe('terminal');
  });

  it('aborts active PUTs, ignores delayed completions and cleans up during cancellation', async () => {
    const { controller, sources } = setup();
    const pending = deferred<'uploaded'>();
    sources.put.mockImplementation(async (_, options) => {
      options?.signal?.addEventListener(
        'abort',
        () => pending.reject(new ImportUploadError('ABORTED')),
        { once: true }
      );
      return pending.promise;
    });
    await select(controller);
    const running = controller.start(selection);
    await vi.waitFor(() => expect(sources.put).toHaveBeenCalled());
    await controller.cancel();
    await running;
    expect(sources.commands.finalize).not.toHaveBeenCalled();
    expect(sources.release).toHaveBeenCalledTimes(2);
    expect(sources.archive.dispose).toHaveBeenCalledTimes(1);
    expect(controller.phase()).toBe('terminal');
  });

  it('cleans up on owner disposal and ignores late archive responses', async () => {
    const { controller, sources, dispose } = setup();
    const discovery = deferred<ReturnType<typeof archiveDiscovery>>();
    sources.archive.discover.mockReturnValue(discovery.promise);
    const running = select(controller);
    dispose();
    discovery.resolve(archiveDiscovery());
    await running;
    expect(controller.phase()).toBe('disposed');
    expect(controller.discovery()).toBeUndefined();
    expect(sources.archive.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps a created job even if subsequent tracking setup fails', async () => {
    const { controller, sources } = setup();
    sources.onJobCreated.mockRejectedValue(new Error('cache failed'));
    await select(controller);
    await controller.start(selection);
    expect(sources.commands.create).toHaveBeenCalledTimes(1);
    expect(sources.onJobCreated).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job' })
    );
    expect(controller.phase()).toBe('monitoring');
    expect(controller.warning()).toContain('Import created');
  });

  it('keeps committed finalization distinct from cache/toast failure', async () => {
    const { controller, sources } = setup();
    sources.onFinalized.mockRejectedValue(new Error('toast failed'));
    await select(controller);
    await controller.start(selection);
    expect(controller.phase()).toBe('monitoring');
    expect(controller.error()).toBeUndefined();
    expect(controller.warning()).toContain('Import saved');
    await controller.finalizeWithSkips();
    expect(sources.commands.finalize).toHaveBeenCalledTimes(1);
    expect(sources.release).toHaveBeenCalledTimes(2);
  });

  it('releases discovery protection on a reader error', async () => {
    const { controller, sources } = setup();
    sources.archive.discover.mockRejectedValue(new Error('broken ZIP'));
    await select(controller);
    expect(controller.phase()).toBe('interrupted');
    expect(sources.release).toHaveBeenCalledTimes(1);
    expect(sources.archive.dispose).toHaveBeenCalledTimes(1);
    expect(sources.commands.create).not.toHaveBeenCalled();
  });

  it('ignores a late registration response after cancellation', async () => {
    const { controller, sources } = setup();
    const registered =
      deferred<Awaited<ReturnType<typeof sources.commands.register>>>();
    sources.commands.register.mockReturnValue(registered.promise);
    await select(controller);
    const running = controller.start(selection);
    await vi.waitFor(() =>
      expect(sources.commands.register).toHaveBeenCalled()
    );
    const cancelling = controller.cancel();
    expect(sources.release).toHaveBeenCalledTimes(2);
    registered.resolve([]);
    await Promise.all([running, cancelling]);
    expect(sources.put).not.toHaveBeenCalled();
    expect(sources.commands.finalize).not.toHaveBeenCalled();
    expect(controller.phase()).toBe('terminal');
  });

  it('retries uncertain finalization without recreating or altering the sealed manifest', async () => {
    const { controller, sources } = setup();
    sources.commands.finalize.mockRejectedValueOnce(new Error('lost response'));
    await select(controller);
    await controller.start(selection);
    expect(controller.phase()).toBe('interrupted');
    await controller.finalizeWithSkips();
    expect(controller.phase()).toBe('monitoring');
    expect(sources.commands.create).toHaveBeenCalledTimes(1);
    expect(sources.commands.register).toHaveBeenCalledTimes(2);
    expect(sources.events.filter((event) => event === 'seal:1')).toHaveLength(
      1
    );
    expect(sources.commands.finalize).toHaveBeenCalledTimes(2);
  });

  it('does not let a delayed finalize response undo a cancellation intent', async () => {
    const { controller, sources } = setup();
    const finalized = deferred<ReturnType<typeof importReceipt>>();
    sources.commands.finalize.mockReturnValue(finalized.promise);
    await select(controller);
    const running = controller.start(selection);
    await vi.waitFor(() => expect(controller.phase()).toBe('finalizing'));
    const cancelling = controller.cancel();
    finalized.resolve(
      importReceipt({
        revision: 10,
        status: 'processing',
        registrationClosed: true,
      })
    );
    sources.commands.cancel.mockResolvedValue(
      importReceipt({ revision: 11, status: 'cancelled' })
    );
    await Promise.all([running, cancelling]);
    expect(controller.phase()).toBe('terminal');
    expect(sources.onFinalized).not.toHaveBeenCalled();
  });

  it('disposes during upload even when a transport ignores the abort signal', async () => {
    const { controller, sources, dispose } = setup();
    const uploaded = deferred<'uploaded'>();
    sources.put.mockReturnValue(uploaded.promise);
    await select(controller);
    const running = controller.start(selection);
    await vi.waitFor(() => expect(sources.put).toHaveBeenCalled());
    dispose();
    expect(sources.release).toHaveBeenCalledTimes(2);
    uploaded.resolve('uploaded');
    await running;
    expect(controller.phase()).toBe('disposed');
    expect(sources.commands.complete).not.toHaveBeenCalled();
    expect(sources.commands.finalize).not.toHaveBeenCalled();
  });

  it('exposes sanitized skip reasons but no inaccessible target identity', async () => {
    const { controller, sources } = setup();
    await select(controller);
    await controller.start(selection);
    const receipt = importReceipt({
      revision: 100,
      status: 'completed_with_errors',
    });
    receipt.conversations = [
      {
        ...receipt.conversations[0],
        status: 'skipped',
        channelId: 'secret-target',
        warnings: ['target_unavailable'],
      },
    ];
    sources.setObserved(receipt);
    expect(controller.skips()).toEqual([
      { slackChannelId: 'C123', reason: 'target_unavailable' },
    ]);
    expect(controller.job()?.conversations[0].channelId).toBeUndefined();
  });
});

describe('archive capability integration', () => {
  it('constructs lazily, backpressures callbacks, ignores duplicate/stale responses and deletes scratch storage', async () => {
    const worker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
    } as unknown as Worker;
    const createWorker = vi.fn(() => worker);
    const disposeWorker = vi.fn(async () => {});
    const source = createArchiveSource('session', createWorker, disposeWorker);
    function send(response: ArchiveWorkerResponse): void {
      worker.onmessage?.call(worker, {
        data: response,
      } as MessageEvent<ArchiveWorkerResponse>);
    }
    expect(createWorker).not.toHaveBeenCalled();
    const discovery = source.discover(new Blob(), importLimits);
    send({
      type: 'discovered',
      sessionId: 'other',
      discovery: archiveDiscovery(),
    });
    send({
      type: 'discovered',
      sessionId: 'session',
      discovery: archiveDiscovery(),
    });
    await discovery;
    const gate = deferred<void>();
    const part = vi.fn(async () => {
      await gate.promise;
    });
    const seal = vi.fn(async () => {});
    const prepared = source.prepare({
      ...selection,
      includeMessageHistory: true,
      partLimits: importLimits,
      part,
      seal,
    });
    const response: ArchiveWorkerResponse = {
      type: 'part',
      sessionId: 'session',
      sequence: 0,
      descriptor: historyPart(),
      bytes: new Uint8Array([1, 2]),
    };
    send(response);
    send(response);
    send({ type: 'seal', sessionId: 'session', seal: historySeal() });
    send({ type: 'seal', sessionId: 'session', seal: historySeal() });
    send({ type: 'complete', sessionId: 'session' });
    send({ type: 'complete', sessionId: 'session' });
    expect(worker.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ack_part' })
    );
    gate.resolve();
    await prepared;
    expect(part).toHaveBeenCalledTimes(1);
    expect(seal).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'ack_part',
      sessionId: 'session',
      sequence: 0,
    });
    await source.dispose();
    await source.dispose();
    expect(disposeWorker).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });

  it('rejects pending discovery on disposal', async () => {
    const worker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
    } as unknown as Worker;
    const source = createArchiveSource(
      'session',
      () => worker,
      async () => {}
    );
    const discovering = source.discover(new Blob(), importLimits);
    const rejected = expect(discovering).rejects.toThrow('cancelled');
    await source.dispose();
    await rejected;
  });

  it('registers beforeunload only for the local-file hold and releases it once', () => {
    const release = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const unprotect = protectImportFile(() => release);
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const listener = add.mock.calls[0][1];
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    unprotect();
    unprotect();
    expect(remove).toHaveBeenCalledWith('beforeunload', listener);
    expect(release).toHaveBeenCalledTimes(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
