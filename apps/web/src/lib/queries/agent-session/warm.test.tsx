/** @vitest-environment jsdom */
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { takeWarmAgentSession, useWarmAgentSessionQuery } from './warm';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { warm: vi.fn() },
}));
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.clearAllMocks();
});

it('deduplicates page mounts and claims only the same owner and configuration once', async () => {
  vi.mocked(agentHarnessServiceClient.warm).mockResolvedValue(
    ok({
      session: { id: 'warm-id', model: 'model-a', instructions: null },
    } as never)
  );
  const client = new QueryClient();
  const Hook = () => {
    useWarmAgentSessionQuery(() => 'warm-test-user');
    return null;
  };
  for (let i = 0; i < 2; i++) {
    const host = document.createElement('div');
    disposers.push(
      render(
        () => (
          <QueryClientProvider client={client}>
            <Hook />
          </QueryClientProvider>
        ),
        host
      )
    );
  }
  await vi.waitFor(() =>
    expect(agentHarnessServiceClient.warm).toHaveBeenCalledTimes(1)
  );
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  expect(
    takeWarmAgentSession({ userId: 'other', botId: MACRO_NEW_BOT_ID })
  ).toBeUndefined();
  expect(
    takeWarmAgentSession({
      userId: 'warm-test-user',
      botId: MACRO_NEW_BOT_ID,
      modelOverride: 'different',
    })
  ).toBeUndefined();
  expect(
    takeWarmAgentSession({
      userId: 'warm-test-user',
      botId: MACRO_NEW_BOT_ID,
      instructions: 'different',
    })
  ).toBeUndefined();
  expect(takeWarmAgentSession({ userId: 'warm-test-user' })).toBe('warm-id');
  expect(
    takeWarmAgentSession({ userId: 'warm-test-user', botId: MACRO_NEW_BOT_ID })
  ).toBeUndefined();
  client.clear();
});
