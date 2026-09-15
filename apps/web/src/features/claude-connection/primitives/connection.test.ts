// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  ClaudeConnectionSource,
  ClaudeConnectionStatus,
} from '../core/connection';
import { createClaudeConnection } from './connection';

function setup() {
  return createRoot((dispose) => {
    const [status, setStatus] = createSignal<ClaudeConnectionStatus>({
      enabled: true,
      connected: false,
      ephemeral: true,
    });
    const source: ClaudeConnectionSource = {
      status,
      failed: () => false,
      begin: vi.fn(async () => ({
        attemptId: 'attempt',
        authorizationUrl: 'https://claude.com/consent',
        expiresIn: 600,
      })),
      complete: vi.fn(async () => {
        setStatus({ ...status(), connected: true });
      }),
      disconnect: vi.fn(async () => {
        setStatus({ ...status(), connected: false });
      }),
      refresh: vi.fn(async () => {}),
    };
    return { state: createClaudeConnection(source), source, dispose };
  });
}
describe('Claude connection controller', () => {
  it('connects and immediately clears the one-time code, then disconnects', async () => {
    const { state, source, dispose } = setup();
    await state.begin();
    expect(state.login()?.attemptId).toBe('attempt');
    state.setCode('one-time#state');
    const done = state.complete();
    expect(state.code()).toBe('');
    expect(state.busy()).toBe(true);
    await done;
    expect(source.complete).toHaveBeenCalledWith('attempt', 'one-time#state');
    expect(state.status()?.connected).toBe(true);
    expect(state.login()).toBeUndefined();
    await state.disconnect();
    expect(state.status()?.connected).toBe(false);
    dispose();
  });
  it('shows an exchange error and requires a fresh attempt instead of replaying', async () => {
    const { state, source, dispose } = setup();
    vi.mocked(source.complete).mockRejectedValueOnce(new Error('Expired code'));
    await state.begin();
    state.setCode('expired#state');
    await state.complete();
    expect(state.error()).toBe('Expired code');
    expect(state.code()).toBe('');
    expect(state.login()).toBeUndefined();
    expect(state.busy()).toBe(false);
    await state.complete();
    expect(source.complete).toHaveBeenCalledTimes(1);
    dispose();
  });
  it('expires an unfinished attempt and cancels explicitly', async () => {
    vi.useFakeTimers();
    const { state, source, dispose } = setup();
    await state.begin();
    state.setCode('private#state');
    vi.advanceTimersByTime(600_000);
    expect(state.login()).toBeUndefined();
    expect(state.code()).toBe('');
    expect(state.error()).toContain('expired');
    await state.begin();
    await state.disconnect();
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(state.login()).toBeUndefined();
    dispose();
    vi.useRealTimers();
  });
});
