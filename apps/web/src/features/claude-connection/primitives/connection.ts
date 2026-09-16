import { createSignal, onCleanup } from 'solid-js';
import type {
  ClaudeConnectionSource,
  ClaudeLogin,
  ClaudeSignIn,
} from '../core/connection';

/** Owns consent UI state; the source owns transport and cache invalidation. */
export function createClaudeConnection(
  source: ClaudeConnectionSource,
  openSignIn: () => ClaudeSignIn | undefined
) {
  const [login, setLogin] = createSignal<ClaudeLogin>();
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  let pendingSignIn: ClaudeSignIn | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(expiry);
    setLogin(undefined);
    setCode('');
  };
  onCleanup(() => {
    disposed = true;
    pendingSignIn?.close();
    pendingSignIn = undefined;
    clearTimeout(expiry);
    setCode('');
  });
  const report = (error: unknown) =>
    setError(
      error instanceof Error
        ? error.message
        : 'Claude connection failed. Please try again.'
    );

  async function begin() {
    if (busy()) return;
    clear();
    setBusy(true);
    setError('');
    try {
      // Reserve the tab before the first await to retain the user's click activation.
      pendingSignIn = openSignIn();
      const next = await source.begin();
      if (disposed) return;
      setLogin(next);
      expiry = setTimeout(() => {
        clear();
        setError('Sign-in expired. Start Connect Claude again.');
      }, next.expiresIn * 1000);
      pendingSignIn?.navigate(next.authorizationUrl);
      pendingSignIn = undefined;
    } catch (error) {
      pendingSignIn?.close();
      pendingSignIn = undefined;
      if (!disposed) report(error);
    } finally {
      if (!disposed) setBusy(false);
    }
  }
  async function complete() {
    const current = login();
    const pasted = code().trim();
    if (busy() || !current || !pasted) return;
    setCode('');
    setBusy(true);
    setError('');
    try {
      await source.complete(current.attemptId, pasted);
      if (!disposed) clear();
    } catch (error) {
      if (!disposed) {
        clear();
        report(error);
      }
    } finally {
      if (!disposed) setBusy(false);
    }
  }
  async function disconnect() {
    if (busy()) return;
    clear();
    setBusy(true);
    setError('');
    try {
      await source.disconnect();
    } catch (error) {
      if (!disposed) report(error);
    } finally {
      if (!disposed) setBusy(false);
    }
  }
  async function refresh() {
    setError('');
    try {
      await source.refresh();
    } catch (error) {
      if (!disposed) report(error);
    }
  }
  return {
    status: source.status,
    failed: source.failed,
    login,
    code,
    setCode,
    busy,
    error,
    begin,
    complete,
    disconnect,
    refresh,
  };
}
