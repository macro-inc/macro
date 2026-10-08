import { webcrypto } from 'node:crypto';
import { fetchWithToken } from '@core/util/fetchWithToken';
import {
  importIsActive,
  type SlackImportClient,
  slackImportJobOptions,
  slackImportListOptions,
} from '@queries/slack-import';
import { slackImportKeys } from '@queries/slack-import/keys';
import { storageServiceClient } from '@service-storage/client';
import type { ImportPage } from '@service-storage/generated/schemas/importPage';
import type { ImportProgress } from '@service-storage/generated/schemas/importProgress';
import type { UploadGrant } from '@service-storage/generated/schemas/uploadGrant';
import type { uploadSlackImport } from '@service-storage/slack-import-upload';
import { focusManager, QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CreateImport, ImportUploadError } from '../context/contracts';
import { createImportController } from '../primitives/import-controller';
import { archiveDiscovery, fakeImportSources } from '../tests/fake-sources';
import {
  createImportSource,
  type ImportSourceDependencies,
} from './import-source';

// Keep the real storage-client serialization; replace only authentication/transport
// and unrelated application singletons imported by the legacy client module.
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_DOCX_TO_PDF: false }));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: {},
  usePaywallState: () => ({ showPaywall: vi.fn() }),
}));
vi.mock('@core/util/mockClient', () => ({ registerClient: vi.fn() }));

const teamId = '01900000-0000-7000-8000-000000000001';
const jobId = '01900000-0000-7000-8000-000000000002';
const otherTeam = '01900000-0000-7000-8000-000000000003';
const otherJob = '01900000-0000-7000-8000-000000000004';
const identity = { teamId, jobId };
const limits = {
  conversations: 2000,
  databaseBatchBytes: 4194304,
  databaseBatchMessages: 500,
  jsonBytes: 33554432,
  partBytes: 16777216,
  partRecords: 20000,
  recordBytes: 1048576,
  registrationBatch: 50,
  selectedBytes: 2147483648,
  zipEntries: 100000,
};

function receipt(overrides: Partial<ImportProgress> = {}): ImportProgress {
  return {
    jobId,
    source: { kind: 'confirmed_unknown' },
    includeMessageHistory: false,
    status: 'uploading',
    revision: 1,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    usersVerified: false,
    limits,
    conversations: [
      {
        slackChannelId: 'C123',
        name: 'General',
        kind: 'public_channel',
        archived: false,
        status: 'awaiting_uploads',
        verifiedParts: 0,
        counters: {
          processed: 0,
          imported: 0,
          skipped: 0,
          duplicates: 0,
          reactions: 0,
        },
        search: { status: 'not_needed' },
        warnings: [],
      },
    ],
    ...overrides,
  };
}
function page(job = receipt()): ImportPage {
  return { jobs: [job], limits, sourceBinding: { kind: 'unbound' } };
}
function fakeClient() {
  return {
    listSlackImports: vi.fn<SlackImportClient['listSlackImports']>(async () =>
      ok(page())
    ),
    getSlackImport: vi.fn<SlackImportClient['getSlackImport']>(async () =>
      ok(receipt())
    ),
    createSlackImport: vi.fn<SlackImportClient['createSlackImport']>(async () =>
      ok(receipt())
    ),
    registerSlackImportUploads: vi.fn<
      SlackImportClient['registerSlackImportUploads']
    >(async () => ok([])),
    completeSlackImportUploads: vi.fn<
      SlackImportClient['completeSlackImportUploads']
    >(async () => ok(receipt())),
    finalizeSlackImport: vi.fn<SlackImportClient['finalizeSlackImport']>(
      async () => ok(receipt())
    ),
    cancelSlackImport: vi.fn<SlackImportClient['cancelSlackImport']>(async () =>
      ok(receipt({ status: 'cancelled' }))
    ),
  };
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(fetchWithToken).mockReset();
});

function mount(initialEnabled = true, transport?: SlackImportClient) {
  const client = fakeClient();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  type Listener = Parameters<ImportSourceDependencies['gatewayEffect']>[0];
  const listeners = new Set<Listener>();
  const upload = vi.fn<typeof uploadSlackImport>(async () => ok('uploaded'));
  const [team, setTeam] = createSignal<string | undefined>(teamId);
  const [job, setJob] = createSignal<string | undefined>(jobId);
  const [enabled, setEnabled] = createSignal(initialEnabled);
  const mounted = createRoot((dispose) => {
    const adapter = createImportSource(
      {
        client: transport ?? client,
        queryClient,
        upload,
        gatewayEffect(listener) {
          listeners.add(listener);
          onCleanup(() => listeners.delete(listener));
        },
      },
      { teamId: team, jobId: job, enabled }
    );
    return { ...adapter, dispose };
  });
  cleanups.push(() => {
    mounted.dispose();
    queryClient.clear();
  });
  return {
    ...mounted,
    client,
    queryClient,
    upload,
    listeners,
    setTeam,
    setJob,
    setEnabled,
    emit(data: unknown, type = 'slack_import_updated') {
      for (const listener of listeners) listener({ type, data });
    },
  };
}
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

describe('import source', () => {
  it('uses stable empty placeholders, never previous-team receipts', () => {
    const client = fakeClient();
    const first = slackImportListOptions(client, teamId, true);
    const next = slackImportListOptions(client, otherTeam, true);
    expect(first.placeholderData).toBe(next.placeholderData);
    expect(first.placeholderData).toEqual({ teamId: null, value: null });
    expect(slackImportJobOptions(client, identity, true).placeholderData).toBe(
      slackImportJobOptions(client, { teamId: otherTeam, jobId }, false)
        .placeholderData
    );
  });

  it.each(['uploading', 'processing', 'cancelling'] as const)(
    'treats %s as active work',
    (status) => {
      expect(importIsActive(receipt({ status }))).toBe(true);
    }
  );

  it.each([
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
  ] as const)('treats %s as idle without pending indexing', (status) => {
    expect(importIsActive(receipt({ status }))).toBe(false);
  });

  it('reports initial failures without reading pending resource data', async () => {
    const h = mount(false);
    const failure = err([
      { code: 'NETWORK_ERROR' as const, message: 'offline' },
    ]);
    h.client.listSlackImports.mockResolvedValue(failure);
    h.client.getSlackImport.mockResolvedValue(failure);
    h.setEnabled(true);
    await settle();
    expect(h.source.page()).toBeUndefined();
    expect(h.source.job()).toBeUndefined();
    expect(h.source.error()?.message).toBe('offline');
  });

  it('releases query polling and hides receipts on disposal', async () => {
    const h = mount();
    await settle();
    expect(h.source.job()?.jobId).toBe(jobId);
    h.dispose();
    expect(h.source.job()).toBeUndefined();
    expect(h.source.page()).toBeUndefined();
    expect(h.listeners.size).toBe(0);
    const calls = h.client.getSlackImport.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.client.getSlackImport).toHaveBeenCalledTimes(calls);
  });
  it('projects domain receipts without leaking transport envelopes or search receipts', async () => {
    const h = mount();
    await settle();
    const job = h.source.job();
    expect(job?.teamId).toBe(teamId);
    expect(job?.conversations[0]).toMatchObject({
      searchStatus: 'not_needed',
      partCount: undefined,
    });
    expect(job?.limits).not.toHaveProperty('databaseBatchBytes');
    expect(job?.conversations[0]).not.toHaveProperty('search');
    expect(h.source.page()?.jobs[0]).toEqual(job);
  });

  it('recovers missed events at 3s while active, then polls idle receipts at 15s', async () => {
    const h = mount();
    await settle();
    h.client.getSlackImport.mockResolvedValue(
      ok(receipt({ status: 'completed', revision: 2 }))
    );
    h.client.listSlackImports.mockResolvedValue(
      ok(page(receipt({ status: 'completed', revision: 2 })))
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.source.job()?.status).toBe('completed');
    expect(h.source.page()?.jobs[0].revision).toBe(2);
    const calls = h.client.getSlackImport.mock.calls.length;
    await vi.advanceTimersByTimeAsync(14000);
    expect(h.client.getSlackImport).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.client.getSlackImport).toHaveBeenCalledTimes(calls + 1);
  });

  it('keeps fast polling while completed history still needs indexing', async () => {
    const h = mount();
    const job = receipt({ status: 'completed' });
    job.conversations[0].search = { status: 'submitted', receiptId: 'receipt' };
    h.client.getSlackImport.mockResolvedValue(ok(job));
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    const calls = h.client.getSlackImport.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.client.getSlackImport).toHaveBeenCalledTimes(calls + 1);
  });

  it('does not fetch or listen when disabled, and hides previously cached receipts', async () => {
    const h = mount(false);
    await settle();
    expect(h.client.listSlackImports).not.toHaveBeenCalled();
    expect(h.client.getSlackImport).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
    expect(h.source.page()).toBeUndefined();
    expect(h.source.job()).toBeUndefined();
    h.setEnabled(true);
    await settle();
    expect(h.source.job()?.jobId).toBe(jobId);
    h.setEnabled(false);
    expect(h.source.job()).toBeUndefined();
    expect(h.source.page()).toBeUndefined();
    await settle();
    expect(h.listeners.size).toBe(0);
    const calls = h.client.getSlackImport.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.client.getSlackImport).toHaveBeenCalledTimes(calls);
    await h.source.refresh();
    expect(h.client.getSlackImport).toHaveBeenCalledTimes(calls);
  });

  it('gates absent teams and jobs explicitly', async () => {
    const h = mount(false);
    h.setTeam(undefined);
    h.setJob(undefined);
    h.setEnabled(true);
    await settle();
    expect(h.client.listSlackImports).not.toHaveBeenCalled();
    h.setTeam(teamId);
    await settle();
    expect(h.client.listSlackImports).toHaveBeenCalledOnce();
    expect(h.client.getSlackImport).not.toHaveBeenCalled();
    expect(h.source.job()).toBeUndefined();
  });

  it('never displays an old team/job while a new scope is pending and cleans up listeners', async () => {
    const h = mount();
    await settle();
    expect(h.listeners.size).toBe(1);
    const oldListener = [...h.listeners][0];
    h.client.getSlackImport.mockImplementation(
      async () => new Promise(() => {})
    );
    h.client.listSlackImports.mockImplementation(
      async () => new Promise(() => {})
    );
    h.setTeam(otherTeam);
    expect(h.source.job()).toBeUndefined();
    expect(h.source.page()).toBeUndefined();
    await settle();
    expect(h.listeners.size).toBe(1);
    expect(h.listeners.has(oldListener)).toBe(false);
    h.setTeam(teamId);
    await settle();
    h.setJob(otherJob);
    expect(h.source.job()).toBeUndefined();
    h.dispose();
    expect(h.listeners.size).toBe(0);
    expect(h.source.job()).toBeUndefined();
  });

  it('ignores stale in-flight responses after a team switch', async () => {
    const h = mount(false);
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<SlackImportClient['getSlackImport']>>
      >();
    h.client.getSlackImport.mockReturnValue(pending.promise);
    h.setEnabled(true);
    await settle();
    h.client.getSlackImport.mockImplementation(
      async () => new Promise(() => {})
    );
    h.setTeam(otherTeam);
    await settle();
    pending.resolve(ok(receipt()));
    await settle();
    expect(h.source.job()).toBeUndefined();
  });

  it('accepts string/object events, ignores malformed/unrelated events, and scopes invalidation', async () => {
    const h = mount();
    await settle();
    const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
    const event = { teamId, jobId, revision: 2, status: 'processing' };
    for (const data of [
      'bad',
      null,
      {},
      { ...event, revision: '2' },
      { ...event, teamId: otherTeam },
    ])
      h.emit(data);
    h.emit(event, 'import_updated');
    expect(invalidate).not.toHaveBeenCalled();
    h.emit(event);
    h.emit(JSON.stringify(event));
    expect(invalidate).toHaveBeenCalledTimes(4);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: slackImportKeys.job(teamId, jobId).queryKey,
      exact: true,
    });
    h.dispose();
    h.emit(event);
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  it('retains available data through background failures and refresh awaits requests', async () => {
    const h = mount();
    await settle();
    h.client.getSlackImport.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'offline' }])
    );
    await expect(h.source.refresh()).rejects.toThrow('offline');
    await settle();
    expect(h.source.job()?.jobId).toBe(jobId);
    expect(h.source.error()).toBeInstanceOf(Error);
  });
});

const createRequest: CreateImport = {
  idempotencyToken: jobId,
  includeMessageHistory: false,
  source: { kind: 'confirmed_unknown' },
  conversations: [
    {
      slackChannelId: 'C123',
      kind: 'public_channel',
      name: 'General',
      folder: 'general',
      memberIds: [],
      creatorId: null,
      createdAt: null,
      archived: false,
      messageCount: null,
    },
  ],
};
const grant: UploadGrant = {
  descriptor: {
    upload: { kind: 'users' },
    sha256: 'a'.repeat(64),
    byteLength: 2,
  },
  expiresAt: '2099-01-01T00:00:00Z',
  url: 'https://storage.invalid/upload',
  requiredHeaders: {},
};

describe('import commands', () => {
  it('serializes exactly the frozen A/C confirmation through the real storage client, including retry and zero-history seals', async () => {
    vi.useRealTimers();
    vi.stubGlobal('crypto', webcrypto);
    const fake = fakeImportSources();
    const found = archiveDiscovery();
    found.conversations = ['CA', 'CB', 'CC'].map((slackChannelId) => ({
      ...found.conversations[0],
      slackChannelId,
      name: 'duplicate name',
      folder: slackChannelId,
      memberIds: ['U1', 'U2'],
      creatorId: 'U1',
      createdAt: '1700000000.000001',
      archived: slackChannelId === 'CC',
      messageCount: null,
    }));
    fake.archive.discover.mockResolvedValue(found);
    fake.archive.prepare.mockImplementation(async (options) => {
      expect(options.selectedIds).toEqual(['CA', 'CC']);
      expect(options.includeMessageHistory).toBe(false);
      for (const slackChannelId of options.selectedIds)
        await options.seal({
          slackChannelId,
          partCount: 0,
          manifestSha256: 'b'.repeat(64),
        });
    });
    const confirmed: CreateImport = {
      idempotencyToken: jobId,
      source: { kind: 'confirmed_unknown' },
      includeMessageHistory: false,
      conversations: structuredClone([
        found.conversations[0],
        found.conversations[2],
      ]),
    };
    const persisted = receipt({
      conversations: confirmed.conversations.map((metadata) => ({
        ...receipt().conversations[0],
        slackChannelId: metadata.slackChannelId,
        name: metadata.name,
        kind: metadata.kind,
        archived: metadata.archived,
      })),
    });
    const creates: unknown[] = [];
    const writes: { url: string; body: unknown }[] = [];
    vi.mocked(fetchWithToken).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (init?.method === 'POST') writes.push({ url, body });
      if (url.endsWith('/slack/imports') && init?.method === 'POST') {
        creates.push(body);
        // A caller mutating discovery after confirmation must not change the retry.
        found.conversations[0].memberIds.push('U3');
        found.conversations[2].name = 'changed locally';
        if (creates.length === 1)
          return err([{ code: 'NETWORK_ERROR', message: 'lost response' }]);
        return ok(persisted);
      }
      if (url.endsWith('/uploads'))
        return ok(
          body.descriptors.map((descriptor: UploadGrant['descriptor']) => ({
            ...grant,
            descriptor,
          }))
        );
      if (url.endsWith('/slack/imports')) return ok(page(persisted));
      return ok(persisted);
    });
    const adapter = mount(true, storageServiceClient);
    const controller = createRoot((dispose) => {
      cleanups.push(dispose);
      return createImportController({
        ...fake,
        teamId,
        commands: adapter.commands,
        source: adapter.source,
        newToken: () => jobId,
      });
    });
    await controller.discover(new Blob(['zip']));
    expect(writes).toEqual([]);
    const selection = {
      selectedIds: ['CA', 'CC'],
      includeMessageHistory: false,
      sourceConfirmed: true,
    };
    await Promise.all([
      controller.start(selection),
      controller.start({ ...selection, selectedIds: ['CB'] }),
    ]);
    expect(controller.phase()).toBe('monitoring');
    expect(creates).toEqual([confirmed, confirmed]);
    expect(
      writes
        .filter((write) => write.url.endsWith('/uploads'))
        .map((write) => write.body)
    ).toEqual([
      { descriptors: [expect.objectContaining({ upload: { kind: 'users' } })] },
    ]);
    expect(
      writes
        .filter((write) => write.url.endsWith('/uploads/complete'))
        .map((write) => write.body)
    ).toEqual(
      expect.arrayContaining([
        {
          uploads: [],
          seal: {
            slackChannelId: 'CA',
            partCount: 0,
            manifestSha256: 'b'.repeat(64),
          },
        },
        {
          uploads: [],
          seal: {
            slackChannelId: 'CC',
            partCount: 0,
            manifestSha256: 'b'.repeat(64),
          },
        },
      ])
    );
    await adapter.source.refresh();
    expect(
      adapter.source
        .job()
        ?.conversations.map((conversation) => conversation.slackChannelId)
    ).toEqual(['CA', 'CC']);
    expect(adapter.source.job()?.includeMessageHistory).toBe(false);
  });

  it('rejects oversized route batches before sending them', async () => {
    const h = mount();
    await expect(
      h.commands.register(
        identity,
        Array.from({ length: 51 }, () => grant.descriptor)
      )
    ).rejects.toThrow('batch limit');
    await expect(
      h.commands.complete(
        identity,
        Array.from({ length: 51 }, () => grant.descriptor.upload)
      )
    ).rejects.toThrow('batch limit');
    expect(h.client.registerSlackImportUploads).not.toHaveBeenCalled();
    expect(h.client.completeSlackImportUploads).not.toHaveBeenCalled();
  });

  it('preserves upload error codes for grant renewal without completing failed uploads', async () => {
    const h = mount();
    h.client.registerSlackImportUploads.mockResolvedValue(ok([grant]));
    const [capability] = await h.commands.register(identity, [
      grant.descriptor,
    ]);
    h.upload.mockResolvedValue(err({ code: 'EXPIRED' }));
    await expect(capability.put(new Blob(['{}']))).rejects.toEqual(
      new ImportUploadError('EXPIRED')
    );
    h.upload.mockResolvedValue(err({ code: 'HTTP_ERROR', status: 403 }));
    await expect(capability.put(new Blob(['{}']))).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 403,
    });
    expect(h.client.completeSlackImportUploads).not.toHaveBeenCalled();
  });

  it('keeps failed route requests separate from successful mutations and invalidates only the captured scope', async () => {
    const h = mount();
    await settle();
    const invalidate = vi.spyOn(h.queryClient, 'invalidateQueries');
    h.client.finalizeSlackImport.mockResolvedValueOnce(
      err([{ code: 'NETWORK_ERROR', message: 'offline' }])
    );
    await expect(h.commands.finalize(identity)).rejects.toThrow('offline');
    expect(invalidate).not.toHaveBeenCalled();
    await h.commands.finalize(identity);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: slackImportKeys.job(teamId, jobId).queryKey,
      exact: true,
    });
  });
  it('routes mutations and bounded PUTs through injected storage capabilities', async () => {
    const h = mount();
    await settle();
    expect((await h.commands.create(teamId, createRequest)).teamId).toBe(
      teamId
    );
    expect(h.client.createSlackImport).toHaveBeenCalledWith({
      body: createRequest,
    });
    h.client.registerSlackImportUploads.mockResolvedValue(ok([grant]));
    const [capability] = await h.commands.register(identity, [
      grant.descriptor,
    ]);
    expect(h.client.registerSlackImportUploads).toHaveBeenCalledWith({
      jobId,
      body: { descriptors: [grant.descriptor] },
    });
    expect(capability).not.toHaveProperty('url');
    h.upload.mockResolvedValue(ok('already-exists'));
    const blob = new Blob(['{}']);
    expect(await capability.put(blob)).toBe('already-exists');
    expect(h.upload).toHaveBeenCalledWith(
      grant,
      blob,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // A 412 still requires explicit server verification, never automatic overwrite/completion.
    expect(h.client.completeSlackImportUploads).not.toHaveBeenCalled();
    const seal = {
      slackChannelId: 'C123',
      partCount: 0,
      manifestSha256: 'b'.repeat(64),
    };
    await h.commands.complete(identity, [], seal);
    expect(h.client.completeSlackImportUploads).toHaveBeenCalledWith({
      jobId,
      body: { uploads: [], seal },
    });
    await h.commands.finalize(identity);
    expect(h.client.finalizeSlackImport).toHaveBeenCalledWith({ jobId });
    expect((await h.commands.cancel(identity)).status).toBe('cancelled');
    expect(h.client.cancelSlackImport).toHaveBeenCalledWith({ jobId });
  });

  it('rejects stale commands, late mutation responses and stale upload grants', async () => {
    const h = mount();
    h.client.registerSlackImportUploads.mockResolvedValue(ok([grant]));
    const [capability] = await h.commands.register(identity, [
      grant.descriptor,
    ]);
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<SlackImportClient['createSlackImport']>>
      >();
    h.client.createSlackImport.mockReturnValue(pending.promise);
    const result = h.commands.create(teamId, createRequest);
    const assertion = expect(result).rejects.toThrow('scope');
    h.setTeam(otherTeam);
    await settle();
    pending.resolve(ok(receipt()));
    await assertion;
    await expect(h.commands.cancel(identity)).rejects.toThrow('scope');
    await expect(capability.put(new Blob(['{}']))).rejects.toThrow('scope');
    h.setTeam(teamId);
    await expect(capability.put(new Blob(['{}']))).rejects.toThrow('scope');
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.client.cancelSlackImport).not.toHaveBeenCalled();
  });

  it.each(['disposal', 'team change'] as const)(
    'aborts active uploads on %s',
    async (action) => {
      const h = mount();
      h.client.registerSlackImportUploads.mockResolvedValue(ok([grant]));
      const [capability] = await h.commands.register(identity, [
        grant.descriptor,
      ]);
      h.upload.mockImplementation(
        async (_grant, _blob, options) =>
          new Promise((resolve) => {
            options?.signal?.addEventListener(
              'abort',
              () => resolve(err({ code: 'ABORTED' })),
              { once: true }
            );
          })
      );
      const result = capability.put(new Blob(['{}']));
      const assertion = expect(result).rejects.toThrow('scope');
      if (action === 'disposal') h.dispose();
      else h.setTeam(otherTeam);
      await assertion;
      await expect(h.commands.finalize(identity)).rejects.toThrow('scope');
    }
  );
});
