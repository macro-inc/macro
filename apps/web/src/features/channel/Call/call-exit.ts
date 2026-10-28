/** Choose the destination from the server's hangup result, never roster counts. */
export function getCallExitPath(call: {
  authenticated: boolean;
  callId: string | null | undefined;
  callEnded?: boolean;
  channelId: string | null | undefined;
  scheduledStart?: string | null;
}): string {
  if (!call.authenticated) return '/';
  if (call.callEnded && call.callId)
    return `/calls/call/${encodeURIComponent(call.callId)}`;
  if (call.channelId) return `/channel/${encodeURIComponent(call.channelId)}`;
  if (call.scheduledStart) return '/component/calendar';
  return '/calls';
}
