import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { storageServiceClient } from './client';
import {
  configureCrmAccessAuthority,
  crmAccessAuthority,
} from './crm-access-authority';
import { installCrmCacheHost } from './crm-access-cache';
import type { EmailFollowup } from './generated/schemas/emailFollowup';

vi.mock('@queries/client', () => ({
  queryPersistence: { retire: async () => {} },
  queryClient: { refetchQueries: async () => {} },
}));
const transport = vi.fn<typeof fetch>();
const proof = vi.fn<() => Promise<string>>();
const followup: EmailFollowup = {
  threadId: '00000000-0000-4000-8000-000000000001',
  linkId: '00000000-0000-4000-8000-000000000002',
  reminderId: '00000000-0000-4000-8000-000000000003',
  revision: '00000000-0000-4000-8000-000000000004',
  condition: 'if_no_reply',
  remindAt: '2030-01-01T12:00:00Z',
  state: 'pending',
};

beforeEach(() => {
  transport.mockReset();
  proof.mockReset().mockRejectedValue(new Error('CRM proof unavailable'));
  vi.stubGlobal('fetch', transport);
  installCrmCacheHost(undefined);
  configureCrmAccessAuthority({
    fetchProof: proof,
    retire: (_scope, generation) =>
      cacheSessionGeneration.transition(async () => {}, generation),
  });
  crmAccessAuthority.setSession('viewer');
});
afterEach(() => {
  crmAccessAuthority.setSession(undefined);
  vi.unstubAllGlobals();
});

it('reads and saves a mailbox reminder through the real transport without CRM proof', async () => {
  transport.mockResolvedValueOnce(Response.json({ followup }));
  const read = await storageServiceClient.reminders.getEmailFollowup(
    followup.threadId
  );
  expect(read._unsafeUnwrap()).toEqual(followup);
  transport.mockResolvedValueOnce(Response.json(followup));
  const saved = await storageServiceClient.reminders.setEmailFollowup(
    followup.threadId,
    {
      type: 'set',
      operationId: followup.revision,
      condition: followup.condition,
      remindAt: followup.remindAt,
    }
  );
  expect(saved._unsafeUnwrap()).toEqual(followup);
  expect(proof).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledTimes(2);
  for (const [url, init] of transport.mock.calls) {
    expect(String(url)).toContain(`/reminders/email/${followup.threadId}`);
    expect(new Headers(init?.headers).has('x-macro-crm-access-signal')).toBe(
      true
    );
  }
});

it('rejects a reminder body decoded after a replacement login', async () => {
  const started = Promise.withResolvers<void>();
  const decoding = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      started.resolve();
      await decoding.promise;
      controller.enqueue(
        new TextEncoder().encode(JSON.stringify({ followup }))
      );
      controller.close();
    },
  });
  transport.mockResolvedValueOnce(
    new Response(body, { headers: { 'content-type': 'application/json' } })
  );
  const read = storageServiceClient.reminders.getEmailFollowup(
    followup.threadId
  );
  await started.promise;
  crmAccessAuthority.setSession(undefined);
  crmAccessAuthority.setSession('viewer', 1);
  decoding.resolve();
  expect((await read).isErr()).toBe(true);
  expect(proof).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledOnce();
});
