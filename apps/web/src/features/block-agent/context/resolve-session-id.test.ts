/**
 * @vitest-environment jsdom
 *
 * The two shapes a block id can have — a session, or a placeholder standing
 * in for one being created — resolved into the one the block consumes.
 */

import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => ({
  resolve: undefined as ((id: string) => void) | undefined,
  reject: undefined as (() => void) | undefined,
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    create: vi.fn(
      () =>
        new Promise((resolve) => {
          create.resolve = (id: string) =>
            resolve({ isErr: () => false, value: { session: { id } } });
          create.reject = () => resolve({ isErr: () => true });
        })
    ),
  },
}));

const { startPendingSession } = await import('./pending-session');
const { resolveSessionId } = await import('./resolve-session-id');

/** Let the mocked create's `.then` run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a block id that is already a session', () => {
  it('resolves to itself, never pending', () => {
    createRoot((dispose) => {
      const resolved = resolveSessionId(() => 'session-1');
      expect(resolved.sessionId()).toBe('session-1');
      expect(resolved.pending()).toBe(false);
      expect(resolved.failed()).toBe(false);
      dispose();
    });
  });
});

describe('a placeholder', () => {
  it('has no session until the create lands, then has that one', async () => {
    const placeholder = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      expect(resolved.sessionId()).toBeUndefined();
      expect(resolved.pending()).toBe(true);
      expect(resolved.failed()).toBe(false);

      create.resolve?.('session-9');
      await flush();

      expect(resolved.sessionId()).toBe('session-9');
      expect(resolved.pending()).toBe(false);
      dispose();
    });
  });

  it('fails when the create fails', async () => {
    const placeholder = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.reject?.();
      await flush();

      expect(resolved.failed()).toBe(true);
      expect(resolved.sessionId()).toBeUndefined();
      dispose();
    });
  });

  // A placeholder URL reloaded in a new tab: the create it named belonged to
  // the tab that is gone, so there is nothing to wait for.
  it('with no create behind it is a failure, not a wait', () => {
    createRoot((dispose) => {
      const resolved = resolveSessionId(() => 'pending-nothing');
      expect(resolved.pending()).toBe(false);
      expect(resolved.failed()).toBe(true);
      dispose();
    });
  });
});
