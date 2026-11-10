import { ThrownResultError } from '@core/util/result';
import { resetQueryAccountSession } from '@queries/auth/account-scope';
import { authKeys } from '@queries/auth/keys';
import { userNameCache } from '@queries/auth/user-name-cache-runtime';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createRenderEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDisplayName,
  getDisplayNameParts,
  useDisplayName,
} from './displayName';
import { emailToMacroId } from './macroId';

const mocks = vi.hoisted(() => ({ getUserNamesWithEmail: vi.fn() }));
let client: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getUserNamesWithEmail: mocks.getUserNamesWithEmail },
}));
const unavailable = err([{ code: 'NETWORK_ERROR', message: 'Unavailable' }]);
const IDENTITY = { id: 'macro|viewer@example.com', authenticated: true };
const cleanups: (() => void)[] = [];
function renderLabel(email: string) {
  const id = emailToMacroId(email);
  const labels: string[] = [];
  const dispose = createRoot((dispose) => {
    createRenderEffect(() => labels.push(getDisplayName(id)));
    return dispose;
  });
  cleanups.push(dispose);
  return { labels, dispose };
}
beforeEach(async () => {
  vi.useFakeTimers();
  mocks.getUserNamesWithEmail.mockReset();
  client = new QueryClient();
  client.setQueryData(authKeys.userInfo.queryKey, IDENTITY);
  await resetQueryAccountSession();
  await client.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => IDENTITY,
  });
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  userNameCache().dispose();
  client.clear();
  vi.useRealTimers();
});

describe('display name compatibility over the scoped query cache', () => {
  it('does not continuously refetch a failed mounted label', async () => {
    mocks.getUserNamesWithEmail.mockResolvedValue(unavailable);
    const label = renderLabel('offline@example.com');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledOnce();
    expect(label.labels.at(-1)).toBe('offline@example.com');
  });
  it('retries on a later access after cooldown', async () => {
    const id = 'macro|person@example.com';
    mocks.getUserNamesWithEmail
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(
        ok({ names: [{ id, first_name: 'First', last_name: 'Last' }] })
      );
    const first = renderLabel('person@example.com');
    await vi.advanceTimersByTimeAsync(1000);
    first.dispose();
    const tooSoon = renderLabel('person@example.com');
    await vi.advanceTimersByTimeAsync(1000);
    tooSoon.dispose();
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    const later = renderLabel('person@example.com');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledTimes(2);
    expect(later.labels.at(-1)).toBe('First Last');
  });
  it('preserves structured names, N/A filtering and local-part fallback across recycled IDs', async () => {
    mocks.getUserNamesWithEmail.mockImplementation(
      async ({ user_ids }: { user_ids: string[] }) =>
        ok({
          names: user_ids.map((id) => ({
            id,
            first_name: id.includes('one@') ? 'N/A' : 'First',
            last_name: id.includes('one@') ? 'Only' : null,
          })),
        })
    );
    const [email, setEmail] = createSignal('one@example.com');
    const values: string[] = [];
    createRoot((dispose) => {
      cleanups.push(dispose);
      createRenderEffect(() => {
        const parts = getDisplayNameParts(emailToMacroId(email()), {
          emailFallback: 'local-part',
        });
        values.push(JSON.stringify(parts));
      });
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(values.at(-1)).toBe(
      JSON.stringify({ firstName: '', lastName: 'Only', fullName: 'Only' })
    );
    setEmail('two@example.com');
    expect(values.at(-1)).toContain('two');
    await vi.advanceTimersByTimeAsync(10);
    expect(values.at(-1)).toBe(
      JSON.stringify({ firstName: 'First', lastName: '', fullName: 'First' })
    );
    expect(userNameCache().inspect().active).toBe(1);
  });
  it('wakes mounted labels after an unauthorized auth query is replaced by a confirmed login', async () => {
    mocks.getUserNamesWithEmail.mockResolvedValue(
      ok({ names: [{ id: 'macro|person@example.com', first_name: 'Private' }] })
    );
    const label = renderLabel('person@example.com');
    await vi.advanceTimersByTimeAsync(10);
    await expect(
      client.fetchQuery({
        queryKey: authKeys.userInfo.queryKey,
        retry: false,
        queryFn: async () => {
          throw new ThrownResultError([
            { code: 'UNAUTHORIZED', message: 'Unauthorized' },
          ]);
        },
      })
    ).rejects.toThrow();
    expect(label.labels.at(-1)).toBe('person@example.com');
    await resetQueryAccountSession();
    await client.fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: async () => IDENTITY,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(label.labels.at(-1)).toBe('Private');
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledTimes(2);
  });
  it('clears mounted private names on replacement login and prevents old controls publishing into the new session', async () => {
    const id = emailToMacroId('person@example.com');
    mocks.getUserNamesWithEmail.mockResolvedValue(
      ok({ names: [{ id, first_name: 'Private first' }] })
    );
    const label = renderLabel('person@example.com');
    let controls: ReturnType<typeof useDisplayName>[1] | undefined;
    createRoot((dispose) => {
      cleanups.push(dispose);
      [, controls] = useDisplayName(id);
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(label.labels.at(-1)).toBe('Private first');
    await resetQueryAccountSession();
    expect(label.labels.at(-1)).toBe('person@example.com');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledOnce();
    mocks.getUserNamesWithEmail.mockResolvedValue(
      ok({ names: [{ id, first_name: 'Private second' }] })
    );
    await client.fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: async () => IDENTITY,
    });
    if (id)
      controls?.mutate({
        id,
        firstName: 'Old callback',
        loading: false,
        _createdAt: new Date(),
      });
    await vi.advanceTimersByTimeAsync(10);
    expect(label.labels.at(-1)).toBe('Private second');
    expect(label.labels).not.toContain('Old callback');
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledTimes(2);
  });
});
