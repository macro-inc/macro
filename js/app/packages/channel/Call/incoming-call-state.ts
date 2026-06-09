import type { PlatformNotificationHandle } from '@notifications';
import { createStore } from 'solid-js/store';

export type IncomingCall = {
  channelId: string;
  callId: string;
  createdAt: string;
  createdBy: string | null;
};

const [incomingCalls, setIncomingCalls] = createStore<IncomingCall[]>([]);
const cleanups = new Map<string, Set<() => void>>();
const dismissedCallIds = new Set<string>();

function cleanupCall(callId: string) {
  const callCleanups = cleanups.get(callId);
  cleanups.delete(callId);
  for (const cleanup of callCleanups ?? []) cleanup();
}

export function addIncomingCall(call: IncomingCall) {
  if (dismissedCallIds.has(call.callId)) return;

  setIncomingCalls((calls) => {
    const existing = calls.find(
      (candidate) => candidate.callId === call.callId
    );
    if (existing) {
      return calls.map((candidate) =>
        candidate.callId === call.callId ? call : candidate
      );
    }
    return [call, ...calls];
  });
}

export function dismissIncomingCall(callId: string) {
  dismissedCallIds.add(callId);
  cleanupCall(callId);
  setIncomingCalls((calls) =>
    calls.filter((candidate) => candidate.callId !== callId)
  );
}

export function endIncomingCall(params: { callId: string; channelId: string }) {
  dismissedCallIds.delete(params.callId);
  cleanupCall(params.callId);
  setIncomingCalls((calls) =>
    calls.filter(
      (call) =>
        call.callId !== params.callId && call.channelId !== params.channelId
    )
  );
}

export function registerIncomingCallCleanup(
  callId: string,
  cleanup: () => void
) {
  if (!incomingCalls.some((call) => call.callId === callId)) {
    cleanup();
    return;
  }

  const callCleanups = cleanups.get(callId) ?? new Set<() => void>();
  callCleanups.add(cleanup);
  cleanups.set(callId, callCleanups);
}

export function registerIncomingCallNotification(
  callId: string,
  handle: PlatformNotificationHandle
) {
  registerIncomingCallCleanup(callId, () => handle.close());
}

export function useIncomingCalls() {
  return incomingCalls;
}
