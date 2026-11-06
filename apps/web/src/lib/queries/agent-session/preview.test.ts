import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { previewServiceClient } from '../../service-clients/service-preview/client';
import { useAgentPreview } from './preview';

type Options = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
};
const captured = vi.hoisted(() => ({
  read: undefined as (() => Options) | undefined,
}));

vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQuery: (read: () => Options) => {
    captured.read = read;
    return {};
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../service-clients/service-preview/client', () => ({
  previewServiceClient: { get: vi.fn(async () => ok({ preview: null })) },
}));
vi.mock('./queue-sync', () => ({
  subscribeSocketSessionStarted: () => () => {},
}));

it('keeps cached preview requests tied to their key without reading a retired component', async () => {
  const [sessionId, setSessionId] = createSignal<string | undefined>('first');
  let retired = false;
  const dispose = createRoot((dispose) => {
    useAgentPreview(() => {
      if (retired) throw new Error('retired component read');
      return sessionId();
    });
    return dispose;
  });
  const first = captured.read!();
  setSessionId('second');
  const second = captured.read!();
  setSessionId(undefined);
  expect(captured.read!().enabled).toBe(false);
  dispose();
  retired = true;

  await first.queryFn();
  await second.queryFn();
  expect(first.queryKey).not.toEqual(second.queryKey);
  expect(previewServiceClient.get).toHaveBeenNthCalledWith(1, 'first');
  expect(previewServiceClient.get).toHaveBeenNthCalledWith(2, 'second');
});
