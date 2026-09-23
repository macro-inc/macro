import { useQuery } from '@tanstack/solid-query';
import { expect, it, vi } from 'vitest';
import { useAgentSessionQuery } from './session';

const getSession = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { get: getSession },
}));
vi.mock('@core/util/result', () => ({
  throwOnErr: (run: () => Promise<unknown>) => run(),
}));
vi.mock('@tanstack/solid-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: vi.fn(),
}));

type SessionOptions = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  refetchInterval: (query: {
    state: {
      data?: { status: { kind: string; event?: string } };
      dataUpdateCount: number;
      errorUpdateCount: number;
    };
  }) => number | false;
};

it('keeps cached fetches bound to their session and preserves the polling budget', async () => {
  let id = 'first';
  useAgentSessionQuery(() => id);
  const readOptions = vi.mocked(useQuery).mock
    .calls[0][0] as unknown as () => SessionOptions;
  const first = readOptions();
  id = 'second';
  const second = readOptions();
  expect(first.queryKey).not.toEqual(second.queryKey);
  await first.queryFn();
  await second.queryFn();
  expect(getSession.mock.calls).toEqual([['first'], ['second']]);

  const state = { dataUpdateCount: 0, errorUpdateCount: 0 };
  expect(first.refetchInterval({ state })).toBe(5_000);
  for (const status of [
    { kind: 'no_messages' },
    { kind: 'event', event: 'booting' },
  ]) {
    expect(
      first.refetchInterval({ state: { ...state, data: { status } } })
    ).toBe(5_000);
  }
  expect(
    first.refetchInterval({
      state: {
        ...state,
        data: { status: { kind: 'event', event: 'running' } },
      },
    })
  ).toBe(false);
  expect(
    first.refetchInterval({
      state: { dataUpdateCount: 119, errorUpdateCount: 1 },
    })
  ).toBe(false);
  expect(
    first.refetchInterval({
      state: { dataUpdateCount: 0, errorUpdateCount: 120 },
    })
  ).toBe(false);
});
