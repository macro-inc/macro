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
    const signIn = { navigate: vi.fn(), close: vi.fn() };
    const openSignIn = vi.fn(() => signIn as typeof signIn | undefined);
    return {
      state: createClaudeConnection(source, openSignIn),
      source,
      dispose,
      signIn,
      openSignIn,
    };
  });
}
describe('Claude connection controller', () => {
  it('reserves a tab synchronously and navigates after authorization starts', async () => {
    const { state, source, dispose, signIn, openSignIn } = setup();
    const pending = state.begin();
    expect(openSignIn).toHaveBeenCalledOnce();
    expect(openSignIn.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(source.begin).mock.invocationCallOrder[0]
    );
    expect(signIn.navigate).not.toHaveBeenCalled();
    await state.begin();
    await pending;
    expect(openSignIn).toHaveBeenCalledOnce();
    expect(signIn.navigate).toHaveBeenCalledWith('https://claude.com/consent');
    dispose();
    expect(signIn.close).not.toHaveBeenCalled();
  });
  it('keeps the sign-in link available when a popup is blocked', async () => {
    const { state, dispose, openSignIn } = setup();
    openSignIn.mockReturnValue(undefined);
    await state.begin();
    expect(state.login()?.authorizationUrl).toBe('https://claude.com/consent');
    expect(state.error()).toBe('');
    dispose();
  });
  it('closes the reserved tab when authorization setup fails', async () => {
    const { state, source, dispose, signIn } = setup();
    vi.mocked(source.begin).mockRejectedValueOnce(
      new Error('Could not start sign-in')
    );
    await state.begin();
    expect(signIn.close).toHaveBeenCalledOnce();
    expect(signIn.navigate).not.toHaveBeenCalled();
    expect(state.error()).toBe('Could not start sign-in');
    expect(state.busy()).toBe(false);
    dispose();
  });
  it('closes a pending tab on unmount and ignores a late authorization URL', async () => {
    const { state, source, dispose, signIn } = setup();
    let resolve!: (
      login: Awaited<ReturnType<ClaudeConnectionSource['begin']>>
    ) => void;
    vi.mocked(source.begin).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = state.begin();
    dispose();
    expect(signIn.close).toHaveBeenCalledOnce();
    resolve({
      attemptId: 'late',
      authorizationUrl: 'https://claude.com/consent',
      expiresIn: 600,
    });
    await pending;
    expect(signIn.navigate).not.toHaveBeenCalled();
  });
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
