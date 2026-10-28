import { fireAndForget } from '@core/util/fireAndForget';
import { frontendInstanceId } from './frontend-instance';
import type { ReloadReason } from './generated/native-diagnostics';
import { sendNativeDiagnostic } from './native-diagnostics';

const KEY = 'macro-pending-reload';
const REASONS = [
  'cache_replaced_automatic',
  'update_accepted',
  'failed_load_recovery',
  'user_recovery',
  'logout',
] satisfies ReloadReason[];
let requested = false;

/** Record intent before unloading; native acknowledgement is capped at 250ms. */
export function reloadApp(reason: ReloadReason): void {
  if (requested) return;
  requested = true;
  const reloadId = crypto.randomUUID();
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        reloadId,
        reason,
        frontendInstanceId,
        timestampMs: Date.now(),
      })
    );
  } catch {
    /* Storage restrictions must not prevent recovery. */
  }
  fireAndForget(reloadAfterRecording(reloadId, reason), 'app-reload');
}

async function reloadAfterRecording(reloadId: string, reason: ReloadReason) {
  try {
    const recording = sendNativeDiagnostic({
      kind: 'reload_requested',
      reload_id: reloadId,
      reason,
    });
    // The idle decision was just made synchronously. Waiting could let the
    // user foreground the app or start held work before an automatic reload.
    if (reason === 'cache_replaced_automatic') {
      fireAndForget(recording, 'automatic-reload-diagnostic');
    } else {
      await recording;
    }
  } finally {
    window.location.reload();
  }
}

/** Consume once; this is reload intent, never proof the request caused a crash. */
export function consumeReloadIntent(now = Date.now()) {
  try {
    const saved = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!saved) return undefined;
    const value: unknown = JSON.parse(saved);
    if (
      !value ||
      typeof value !== 'object' ||
      !('reason' in value) ||
      !REASONS.some((reason) => reason === value.reason) ||
      !('reloadId' in value) ||
      typeof value.reloadId !== 'string' ||
      value.reloadId.length !== 36 ||
      !('frontendInstanceId' in value) ||
      typeof value.frontendInstanceId !== 'string' ||
      value.frontendInstanceId.length !== 36 ||
      !('timestampMs' in value) ||
      typeof value.timestampMs !== 'number' ||
      !Number.isFinite(value.timestampMs) ||
      now < value.timestampMs ||
      now - value.timestampMs > 30 * 60_000
    )
      return undefined;
    return {
      requested_reload_id: value.reloadId,
      requested_reload_reason: String(value.reason),
      requested_reload_timestamp_ms: value.timestampMs,
      requested_reload_frontend_instance_id: value.frontendInstanceId,
    };
  } catch {
    return undefined;
  }
}
