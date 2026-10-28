import { beforeEach, describe, expect, it, vi } from 'vitest';

const { error } = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error },
}));

import { fireAndForget } from './fireAndForget';

describe('fireAndForget', () => {
  beforeEach(() => {
    error.mockClear();
  });

  it('reports a rejection under the surface', async () => {
    const failure = new Error('boom');
    fireAndForget(Promise.reject(failure), 'test-surface');
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(failure, { surface: 'test-surface' });
    });
  });

  it('reports nothing when the work resolves', async () => {
    fireAndForget(Promise.resolve('done'), 'test-surface');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).not.toHaveBeenCalled();
  });

  it('accepts a value that is not a promise', async () => {
    fireAndForget({ status: 'committed' }, 'test-surface');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).not.toHaveBeenCalled();
  });
});
