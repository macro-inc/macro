type FocusDebugPayload = {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export function focusDebugLog(
  payload: Omit<FocusDebugPayload, 'timestamp'>
): void {
  if (!import.meta.env.DEV) return;
  void fetch('/__agent-focus-debug', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, timestamp: Date.now() }),
  });
}
