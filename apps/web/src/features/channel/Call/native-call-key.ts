/**
 * The native call plugin keys a call by an opaque string it calls `channelId`:
 * it hands the key back when its drawer or Picture in Picture opens, and JS
 * keeps it in the native call snapshot. Channel calls use their channel id.
 * Meetings have no channel to return to, so they use this key, which names
 * the call; the meeting session that owns the call knows its page. Native
 * logs the key, so it never holds the meeting's share token.
 */
const MEETING_KEY_PREFIX = 'meeting:';

export function meetingNativeCallKey(callId: string): string {
  return `${MEETING_KEY_PREFIX}${callId.toLowerCase()}`;
}

/** The meeting call a native call key names, or undefined for a channel. */
export function meetingCallIdOfNativeCallKey(key: string): string | undefined {
  if (!key.startsWith(MEETING_KEY_PREFIX)) return undefined;
  return key.slice(MEETING_KEY_PREFIX.length) || undefined;
}

/** The channel a native call key names, or null for a meeting. */
export function channelIdOfNativeCallKey(key: string): string | null {
  return key.startsWith(MEETING_KEY_PREFIX) ? null : key;
}
