import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { ActionConfiguration } from '@service-scheduled-action/generated/schemas';
import { ROUTINE_LIMIT_ERROR } from '@service-scheduled-action/routine-limit';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { observeRoutineLimitMutations } from './routine-limit-handling';

const paywall = usePaywallState();
const fetch = vi.fn<typeof window.fetch>();
let client: QueryClient;
let unsubscribe: () => void;

beforeEach(() => {
  paywall.hidePaywall();
  fetch.mockReset();
  vi.stubGlobal('fetch', fetch);
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: 0 } },
  });
  unsubscribe = observeRoutineLimitMutations(client);
});

afterEach(() => {
  unsubscribe();
  client.clear();
  paywall.hidePaywall();
  vi.unstubAllGlobals();
});

function refusal(plan: string) {
  return Response.json(
    {
      error: "You've reached your plan's limit of 10 active routines.",
      code: 'routine_limit_reached',
      limit: 10,
      plan,
    },
    { status: 402 }
  );
}

const ROUTINE: ActionConfiguration = {
  name: 'Daily brief',
  kind: 'Agent',
  enabled: true,
  task: {},
  trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
};

const activatingWrites = [
  ['create', () => scheduledActionClient.createSchedule(ROUTINE)],
  [
    'enable',
    () =>
      scheduledActionClient.setEnabled({
        scheduleId: 'routine',
        enabled: true,
      }),
  ],
  [
    'edit',
    () =>
      scheduledActionClient.updateSchedule({
        scheduleId: 'routine',
        body: ROUTINE,
      }),
  ],
  [
    'template activation',
    () =>
      scheduledActionClient.activateTemplate({
        templateId: 'template',
        body: ROUTINE,
      }),
  ],
] as const;

test.each(activatingWrites)(
  '%s returns the refusal with the server message',
  async (_name, write) => {
    fetch.mockResolvedValueOnce(refusal('free'));
    const result = await write();
    expect(result._unsafeUnwrapErr()).toEqual([
      {
        code: ROUTINE_LIMIT_ERROR,
        plan: 'free',
        message: "You've reached your plan's limit of 10 active routines.",
      },
    ]);
  }
);

test.each(['free', 'premium'])(
  'offers an upgrade when a %s plan hits the limit',
  async (plan) => {
    fetch.mockResolvedValueOnce(refusal(plan));
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () =>
        throwOnErr(() =>
          scheduledActionClient.setEnabled({
            scheduleId: 'routine',
            enabled: true,
          })
        ),
    });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(paywall.paywallOpen()).toBe(true);
    expect(paywall.paywallKey()).toBe(PaywallKey.ROUTINE_LIMIT);
  }
);

test('leaves the top plan to the write’s own error message', async () => {
  fetch.mockResolvedValueOnce(refusal('max'));
  const mutation = client.getMutationCache().build(client, {
    mutationFn: () =>
      throwOnErr(() => scheduledActionClient.createSchedule(ROUTINE)),
  });
  await expect(mutation.execute(undefined)).rejects.toThrow(
    "You've reached your plan's limit of 10 active routines."
  );
  expect(paywall.paywallOpen()).toBe(false);
});

test.each([
  { code: 'ai_allowance_exhausted', error: 'Usage blocked' },
  { code: 'routine_limit_reached', error: 'No plan', plan: 'enterprise' },
  null,
])('does not treat another 402 (%j) as the routine limit', async (body) => {
  fetch.mockResolvedValueOnce(Response.json(body, { status: 402 }));
  const mutation = client.getMutationCache().build(client, {
    mutationFn: () =>
      throwOnErr(() => scheduledActionClient.createSchedule(ROUTINE)),
  });
  await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(
    ThrownResultError
  );
  expect(paywall.paywallOpen()).toBe(false);
});
