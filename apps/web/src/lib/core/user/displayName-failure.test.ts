import { err, ok } from 'neverthrow';
import { createRenderEffect, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDisplayName } from './displayName';
import type { MacroId } from './macroId';

const mocks = vi.hoisted(() => ({ getUserNamesWithEmail: vi.fn() }));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getUserNamesWithEmail: mocks.getUserNamesWithEmail },
}));

const unauthorized = err([
  { code: 'UNAUTHORIZED', message: 'Unauthorized access' },
]);

/** Renders `getDisplayName(id)` in a tracked scope, like a JSX label. */
function renderLabel(id: MacroId) {
  const labels: string[] = [];
  const dispose = createRoot((dispose) => {
    createRenderEffect(() => labels.push(getDisplayName(id)));
    return dispose;
  });
  return { labels, dispose };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getUserNamesWithEmail.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getDisplayName after a failed batch', () => {
  it('does not refetch while the label stays rendered', async () => {
    const id = 'macro|signed-out@example.com' as MacroId;
    mocks.getUserNamesWithEmail.mockResolvedValue(unauthorized);
    const label = renderLabel(id);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledTimes(1);
    expect(label.labels.at(-1)).toBe('signed-out@example.com');
    label.dispose();
  });

  it('retries on a later access once the failure has cooled down', async () => {
    const id = 'macro|ada@example.com' as MacroId;
    mocks.getUserNamesWithEmail
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(
        ok({ names: [{ id, first_name: 'Ada', last_name: 'Lovelace' }] })
      );
    const first = renderLabel(id);
    await vi.advanceTimersByTimeAsync(1000);
    first.dispose();

    const tooSoon = renderLabel(id);
    await vi.advanceTimersByTimeAsync(1000);
    tooSoon.dispose();
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    const later = renderLabel(id);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledTimes(2);
    expect(later.labels.at(-1)).toBe('Ada Lovelace');
    later.dispose();
  });
});
