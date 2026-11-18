import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { systemStatusKeys } from './keys';
import {
  currentSystemStatusQueryOptions,
  handleSystemStatusMessage,
} from './status';

const mocks = vi.hoisted(() => ({ getSystemStatus: vi.fn() }));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getSystemStatus: mocks.getSystemStatus },
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

const cached = () =>
  queryClient.getQueryData(systemStatusKeys.current.queryKey);

const outage = {
  status: 'major_outage',
  message: 'Macro is down',
  updatedAt: '2026-10-28T12:00:00.000Z',
} as const;
const recovered = {
  status: 'operational',
  updatedAt: '2026-10-28T12:30:00.000Z',
} as const;

beforeEach(() => {
  queryClient.clear();
  vi.resetAllMocks();
});

it('applies a pushed status, as JSON text or an object', () => {
  handleSystemStatusMessage(JSON.stringify(outage));
  expect(cached()).toEqual(outage);

  handleSystemStatusMessage(recovered);
  expect(cached()).toEqual(recovered);
});

it('ignores a pushed status older than the one shown', () => {
  handleSystemStatusMessage(recovered);
  handleSystemStatusMessage(outage);

  expect(cached()).toEqual(recovered);
});

it('ignores malformed pushes', () => {
  handleSystemStatusMessage(outage);
  handleSystemStatusMessage('{not json');
  handleSystemStatusMessage({ status: 'degraded' });

  expect(cached()).toEqual(outage);
});

it('keeps a newer pushed status over a fetch that started before it', async () => {
  let resolveFetch: (value: unknown) => void = () => {};
  mocks.getSystemStatus.mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve;
    })
  );

  const fetching = queryClient.fetchQuery(currentSystemStatusQueryOptions());
  handleSystemStatusMessage(recovered);
  resolveFetch(ok(outage));
  await fetching;

  expect(cached()).toEqual(recovered);
});
