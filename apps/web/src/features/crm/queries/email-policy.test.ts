import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import type { PreviewItem } from '@queries/preview';
import { crmEmailPolicyClient } from '@service-storage/crm-email-policy';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createEmailPolicySource, createThreadRuleName } from './email-policy';
import { crmKeys } from './keys';

const graphql = vi.hoisted(() => vi.fn());
const fullPreview = vi.hoisted(() => vi.fn());
vi.mock('@queries/preview/graphql', () => ({
  createGraphqlItemPreviewQuery: graphql,
}));
vi.mock('@queries/preview', () => ({ useItemRawName: fullPreview }));

it('keeps unavailable thread labels empty without loading the full thread', () => {
  createRoot((dispose) => {
    const [data, setData] = createSignal<PreviewItem>();
    graphql.mockReturnValue({ data, shouldFallback: () => true });
    const name = createThreadRuleName('thread');
    expect(name()).toBeUndefined();
    setData({ id: 'thread', type: 'email', loading: true });
    expect(name()).toBeUndefined();
    setData({
      id: 'thread',
      type: 'email',
      access: 'access',
      loading: false,
      name: 'Example conversation',
      rawName: 'Example conversation',
    });
    expect(name()).toBe('Example conversation');
    setData({
      id: 'thread',
      type: 'email',
      access: 'no_access',
      loading: false,
    });
    expect(name()).toBeUndefined();
    expect(fullPreview).not.toHaveBeenCalled();
    dispose();
  });
});

it.each(['response', 'cancellation'] as const)(
  'keeps preview success without caching content retired during %s',
  async (phase) => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
    const client = new QueryClient();
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof crmEmailPolicyClient.startPreview>>
      >();
    const started = Promise.withResolvers<void>();
    const canceled = Promise.withResolvers<void>();
    const cancel = Promise.withResolvers<void>();
    const policy = {
      ...crmEmailPolicyClient,
      get: vi.fn<typeof crmEmailPolicyClient.get>().mockResolvedValue(
        ok({
          authoring_available: true,
          enabled: false,
          mode: 'all',
          effect: '',
        })
      ),
      startPreview: vi
        .fn<typeof crmEmailPolicyClient.startPreview>()
        .mockImplementation(() => {
          started.resolve();
          return pending.promise;
        }),
    };
    const source = createRoot((dispose) => ({
      value: createEmailPolicySource(
        { client, policy, feedback: { success: vi.fn(), failure: vi.fn() } },
        () => 'team',
        () => 'viewer'
      ),
      dispose,
    }));
    const spy = vi.spyOn(client, 'cancelQueries').mockImplementation(() => {
      canceled.resolve();
      return phase === 'cancellation' ? cancel.promise : Promise.resolve();
    });
    try {
      const attempt = source.value.startPreview({
        if_policy: { kind: 'legacy', fingerprint: 'observed' },
        if_preview_id: null,
        rules: { schema_version: 1, include: [] },
      });
      await started.promise;
      if (phase === 'response')
        await cacheSessionGeneration.transition(async () => {});
      pending.resolve(
        ok({
          preview_id: 'stale',
          context_id: 'context',
          status: 'complete',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:05:00Z',
          scanned_threads: 1,
          counts: {
            current: 1,
            proposed: 1,
            added: 0,
            removed: 0,
            retained: 1,
            denied: 0,
          },
        })
      );
      if (phase === 'cancellation') {
        await canceled.promise;
        await cacheSessionGeneration.transition(async () => {});
        cancel.resolve();
      }
      const result = await attempt;
      expect(result.isOk()).toBe(true);
      expect(policy.startPreview).toHaveBeenCalledOnce();
      expect(
        client.getQueryData(
          crmKeys.emailPolicyPreview(source.value.scope()).queryKey
        )
      ).toBeUndefined();
    } finally {
      source.dispose();
      spy.mockRestore();
      client.clear();
      queryClient.clear();
    }
  }
);
