import {
  AI_USAGE_LIMIT_ERROR,
  readAiUsageLimitError,
} from '@app/lib/service-clients/ai-usage-limit';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { safeFetch } from '@core/util/safeFetch';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { importClient } from '@service-cognition/import';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  handleAiUsageLimitError,
  observeAiUsageLimitMutations,
} from './ai-usage-limit-handling';

const state = useAiUsageLimitState();
const fetch = vi.fn<typeof window.fetch>();
let client: QueryClient;
let unsubscribe: () => void;

beforeEach(() => {
  state.hideUsageLimit();
  fetch.mockReset();
  vi.stubGlobal('fetch', fetch);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  unsubscribe = observeAiUsageLimitMutations(client);
});

afterEach(() => {
  unsubscribe();
  client.clear();
  state.hideUsageLimit();
  vi.unstubAllGlobals();
});

const spendingActions = [
  [
    'chat send',
    () =>
      cognitionApiServiceClient.sendStreamChatMessage({
        content: 'Hello',
        model: 'test',
      }),
  ],
  [
    'structured completion',
    () =>
      cognitionApiServiceClient.structuredCompletion({
        prompt: 'Answer',
        model: 'test',
        output_schema: { name: 'test', schema: {} },
      }),
  ],
  ['session creation', () => agentHarnessServiceClient.create({})],
  [
    'session control',
    () =>
      agentHarnessServiceClient.control('session', {
        type: 'prompt',
        prompt: 'Hello',
      }),
  ],
  [
    'import',
    () => importClient.runImport({ import_ids: ['id'], discard_ids: [] }),
  ],
  ['gather retry', () => importClient.retryGather('linear')],
  [
    'run schedule',
    () => scheduledActionClient.runNow({ scheduleId: 'schedule' }),
  ],
] as const;

test.each(
  spendingActions.flatMap(([name, action]) =>
    ['ai_allowance_exhausted', 'ai_free_allowance_exhausted'].map((reason) => ({
      name,
      action,
      reason,
    }))
  )
)(
  '$name returns a typed $reason refusal without opening UI in the client',
  async ({ action, reason }) => {
    fetch.mockResolvedValueOnce(
      Response.json({ code: reason, error: 'Usage blocked' }, { status: 402 })
    );
    const result = await action();
    expect(result._unsafeUnwrapErr()).toEqual([
      {
        code: AI_USAGE_LIMIT_ERROR,
        reason,
        message: 'Usage blocked',
      },
    ]);
    expect(state.usageLimitOpen()).toBe(false);
    expect(handleAiUsageLimitError(result._unsafeUnwrapErr())).toBe(true);
    expect(state.usageLimitCode()).toBe(reason);
  }
);

test.each([
  'ai_allowance_exhausted',
  'ai_free_allowance_exhausted',
  'ai_overage_limit_reached',
  'ai_overage_payment_failed',
])(
  'opens the dialog after a foreground mutation fails with %s',
  async (reason) => {
    fetch.mockResolvedValueOnce(
      Response.json({ code: reason, error: 'Usage blocked' }, { status: 402 })
    );
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () =>
        throwOnErr(() =>
          scheduledActionClient.runNow({ scheduleId: 'schedule' })
        ),
    });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(state.usageLimitOpen()).toBe(true);
    expect(state.usageLimitCode()).toBe(reason);
    expect(fetch).toHaveBeenCalledOnce();
  }
);

test('keeps background queries quiet even when the AI client returns a typed refusal', async () => {
  fetch.mockResolvedValueOnce(
    Response.json({ code: 'ai_allowance_exhausted' }, { status: 402 })
  );
  await expect(
    client.fetchQuery({
      queryKey: ['background'],
      queryFn: () =>
        throwOnErr(() =>
          cognitionApiServiceClient.structuredCompletion({
            prompt: 'Answer',
            model: 'test',
            output_schema: { name: 'test', schema: {} },
          })
        ),
    })
  ).rejects.toBeInstanceOf(ThrownResultError);
  expect(state.usageLimitOpen()).toBe(false);
});

test('does not intercept generic HTTP requests even with a quota-shaped body', async () => {
  fetch.mockResolvedValueOnce(
    Response.json({ code: 'ai_allowance_exhausted' }, { status: 402 })
  );
  const result = await safeFetch('https://localhost/not-an-ai-action');
  expect(result._unsafeUnwrapErr()[0].code).toBe('HTTP_ERROR');
  expect(handleAiUsageLimitError(result._unsafeUnwrapErr())).toBe(false);
  expect(state.usageLimitOpen()).toBe(false);
});

test('leaves the response body available to other client error handling', async () => {
  const body = { code: 'ai_allowance_exhausted', error: 'Usage blocked' };
  const response = Response.json(body, { status: 402 });
  expect(await readAiUsageLimitError(response)).toMatchObject({
    reason: body.code,
  });
  expect(await response.json()).toEqual(body);
});

test.each([
  [402, { code: 'paid_plan_required' }],
  [402, { code: 'unknown_code' }],
  [402, { code: 1 }],
  [402, null],
  [503, { code: 'ai_billing_unavailable' }],
  [403, { code: 'ai_allowance_exhausted' }],
])(
  'does not classify unrelated HTTP %i (%j) as a quota refusal',
  async (status, body) => {
    fetch.mockResolvedValueOnce(Response.json(body, { status }));
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () =>
        throwOnErr(() =>
          scheduledActionClient.runNow({ scheduleId: 'schedule' })
        ),
    });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(state.usageLimitOpen()).toBe(false);
  }
);

test('keeps malformed 402 responses as ordinary HTTP errors', async () => {
  fetch.mockResolvedValueOnce(
    new Response('Payment required', { status: 402 })
  );
  const result = await scheduledActionClient.runNow({ scheduleId: 'schedule' });
  expect(result._unsafeUnwrapErr()[0].code).toBe('HTTP_ERROR');
  expect(handleAiUsageLimitError(result._unsafeUnwrapErr())).toBe(false);
});

test('keeps service-specific error messages intact', async () => {
  fetch.mockResolvedValueOnce(
    new Response('Model is unavailable.', { status: 422 })
  );
  const result = await agentHarnessServiceClient.control('session', {
    type: 'setModel',
    model: 'missing',
  });
  expect(result._unsafeUnwrapErr()[0].message).toBe('Model is unavailable.');
  expect(handleAiUsageLimitError(result._unsafeUnwrapErr())).toBe(false);
});

test('preserves generic server-error retries', async () => {
  fetch.mockResolvedValueOnce(Response.json({}, { status: 500 }));
  fetch.mockResolvedValueOnce(Response.json({ ok: true }));
  const result = await safeFetch('https://localhost/request', {
    retry: { maxTries: 2, delay: 0 },
  });
  expect(result.isOk()).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(state.usageLimitOpen()).toBe(false);
});

test('stops handling mutation failures when the app subscription is disposed', async () => {
  unsubscribe();
  fetch.mockResolvedValueOnce(
    Response.json({ code: 'ai_allowance_exhausted' }, { status: 402 })
  );
  const mutation = client.getMutationCache().build(client, {
    mutationFn: () =>
      throwOnErr(() =>
        scheduledActionClient.runNow({ scheduleId: 'schedule' })
      ),
  });
  await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(
    ThrownResultError
  );
  expect(state.usageLimitOpen()).toBe(false);
});
