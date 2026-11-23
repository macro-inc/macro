import { catchToResult } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { callMediaErrorType } from './call-media-telemetry';

/** Android's native join rejects with this when the microphone is denied. */
const NATIVE_MICROPHONE_DENIED = 'Microphone permission is required for calls';
const microphonePermissionState = z.object({ granted: z.boolean() });

export function isMicrophoneAccessError(error: unknown): boolean {
  return (
    error === NATIVE_MICROPHONE_DENIED ||
    callMediaErrorType(error) === 'NotAllowedError'
  );
}

/**
 * iOS asks before the join API runs, over the call the user just started.
 * A denial still joins, muted; the native session explains how to fix it.
 */
export async function requestIosMicrophonePermission(): Promise<void> {
  await Telemetry.span('call.microphone_permission.request', async (span) => {
    const result = await catchToResult(() =>
      invoke<unknown>('plugin:call-kit|request_microphone_permission')
    );
    if (result.isErr()) {
      // The native session asks again once the room connects.
      console.error(
        '[callkit] failed to request microphone permission',
        result.error
      );
      span.setAttr('call.microphone_permission.outcome', 'failed');
      return;
    }
    const granted = microphonePermissionState.safeParse(result.value).data
      ?.granted;
    span.setAttr(
      'call.microphone_permission.outcome',
      granted ? 'granted' : 'denied'
    );
  });
}
