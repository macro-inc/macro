import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendNativeDiagnostic } from './native-diagnostics';

vi.mock('./native-diagnostics', () => ({ sendNativeDiagnostic: vi.fn() }));
const reload = vi.fn();
beforeEach(() => {
  vi.resetModules();
  vi.mocked(sendNativeDiagnostic).mockReset().mockResolvedValue(undefined);
  reload.mockClear();
  sessionStorage.clear();
  vi.stubGlobal('window', { location: { reload } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('persists intent before native IPC and reloads only after acknowledgement', async () => {
  let acknowledge: (() => void) | undefined;
  vi.mocked(sendNativeDiagnostic).mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  const app = await import('./reload');
  app.reloadApp('user_recovery');
  app.reloadApp('logout');
  expect(reload).not.toHaveBeenCalled();
  expect(sendNativeDiagnostic).toHaveBeenCalledOnce();
  const intent = app.consumeReloadIntent();
  expect(intent).toMatchObject({ requested_reload_reason: 'user_recovery' });
  expect(intent?.requested_reload_id).toHaveLength(36);
  expect(app.consumeReloadIntent()).toBeUndefined();
  acknowledge?.();
  await Promise.resolve();
  expect(reload).toHaveBeenCalledOnce();
});

it('telemetry or storage failure cannot prevent the requested reload', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  vi.mocked(sendNativeDiagnostic).mockRejectedValue(new Error('bridge gone'));
  const app = await import('./reload');
  app.reloadApp('update_accepted');
  await Promise.resolve();
  expect(reload).toHaveBeenCalledOnce();
});

it('does not attribute an old or malformed marker to a later startup', async () => {
  const app = await import('./reload');
  sessionStorage.setItem(
    'macro-pending-reload',
    JSON.stringify({
      reason: 'user_recovery',
      reloadId: crypto.randomUUID(),
      frontendInstanceId: crypto.randomUUID(),
      timestampMs: 1,
    })
  );
  expect(app.consumeReloadIntent(31 * 60_000)).toBeUndefined();
  sessionStorage.setItem('macro-pending-reload', '{');
  expect(app.consumeReloadIntent()).toBeUndefined();
});

it('does not delay an automatic reload beyond the synchronous idle decision', async () => {
  vi.mocked(sendNativeDiagnostic).mockImplementation(
    () => new Promise(() => {})
  );
  const app = await import('./reload');
  app.reloadApp('cache_replaced_automatic');
  expect(reload).toHaveBeenCalledOnce();
  expect(app.consumeReloadIntent()?.requested_reload_reason).toBe(
    'cache_replaced_automatic'
  );
});
