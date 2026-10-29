import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';
import type { DesktopSnapshot } from './desktop';
import { clearDocumentLifecycle } from './document-lifecycle';
import { frontendInstanceId } from './frontend-instance';
import type { FrontendEvent } from './generated/native-diagnostics';

// Document-owned diagnostics, never application state. Older native binaries
// advertise no recentEvents field and receive no new command invocations.
let supported: boolean | undefined;
let capable = false;
let retired = false;
const LEASE = 'macro-native-diagnostic-document';
const MAX_PENDING_DIAGNOSTICS = 32;
const MAX_DIAGNOSTIC_TIMEOUTS = 3;
let previousFrontend: string | undefined;
const pending: FrontendEvent[] = [];
let inFlight = 0;
let timeouts = 0;

export function nativeDiagnosticsRetired(): boolean {
  return retired;
}

export function recoverableNativeFrontend(): string | undefined {
  return previousFrontend;
}

/** Best effort, bounded IPC; a stuck bridge must never accumulate promises. */
export async function sendNativeDiagnostic(
  event: FrontendEvent
): Promise<void> {
  if (
    !isTauri() ||
    (retired &&
      !['reload_requested', 'account_cleared', 'started'].includes(event.kind))
  )
    return;
  if (supported === undefined) {
    if (pending.length < MAX_PENDING_DIAGNOSTICS) pending.push(event);
    return;
  }
  const clearing = event.kind === 'account_cleared' && capable;
  // A timed-out invoke may still be pending in the bridge. Keep it charged
  // against the document's budget even after the caller stops waiting.
  if (
    (!supported || inFlight + timeouts >= MAX_PENDING_DIAGNOSTICS) &&
    !clearing
  )
    return;
  inFlight++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      invoke('record_frontend_diagnostic', { frontendInstanceId, event }),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timeouts++;
          if (timeouts >= MAX_DIAGNOSTIC_TIMEOUTS) supported = false;
          resolve();
        }, 250);
      }),
    ]);
  } catch {
    // A rejected native command disables diagnostics immediately for this document.
    supported = false;
  } finally {
    clearTimeout(timer);
    inFlight--;
  }
}

export function recordNativeDiagnostic(event: FrontendEvent): void {
  fireAndForget(sendNativeDiagnostic(event), 'native-diagnostics');
}

/** Await before clearing auth, then reject late callbacks from the old account. */
export async function clearNativeDiagnostics(): Promise<void> {
  clearDocumentLifecycle();
  previousFrontend = undefined;
  try {
    sessionStorage.removeItem(LEASE);
  } catch {
    /* Replay requires a readable lease. */
  }
  pending.length = 0;
  const clearing = sendNativeDiagnostic({ kind: 'account_cleared' });
  retired = true;
  await clearing;
}

export function startNativeDiagnostics(
  snapshot: DesktopSnapshot | undefined
): () => void {
  supported = snapshot?.recentEvents !== undefined;
  capable = supported;
  if (!supported) {
    pending.length = 0;
    return () => {};
  }
  const nativeId = snapshot?.identity.instanceId;
  try {
    const lease = sessionStorage.getItem(LEASE)?.split(':');
    previousFrontend = lease && lease[0] === nativeId ? lease[1] : undefined;
    if (!retired)
      sessionStorage.setItem(LEASE, `${nativeId}:${frontendInstanceId}`);
  } catch {
    // No proof that these entries belong to this signed-in session: don't export them.
    previousFrontend = undefined;
  }
  recordNativeDiagnostic({
    kind: 'started',
    previous_instance_id:
      snapshot?.recentEvents?.currentFrontendInstanceId ?? null,
  });
  if (retired) {
    pending.length = 0;
    recordNativeDiagnostic({ kind: 'account_cleared' });
    return () => {};
  }
  for (const event of pending.splice(0)) recordNativeDiagnostic(event);
  const heartbeat = () =>
    recordNativeDiagnostic({
      kind: 'heartbeat',
      visible: document.visibilityState === 'visible',
      online: navigator.onLine,
    });
  const visibility = () => {
    recordNativeDiagnostic({
      kind: 'visibility',
      visible: document.visibilityState === 'visible',
    });
    heartbeat();
  };
  const connectivity = () =>
    recordNativeDiagnostic({ kind: 'connectivity', online: navigator.onLine });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', connectivity);
  window.addEventListener('offline', connectivity);
  heartbeat();
  const timer = setInterval(() => {
    // Background timer throttling is expected, not evidence of a hung frontend.
    if (document.visibilityState === 'visible') heartbeat();
  }, 5000);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', connectivity);
    window.removeEventListener('offline', connectivity);
  };
}
