/**
 * Which agent session each channel is showing, for the debug controls.
 *
 * Reactive because the log fetch that answers it lands after the channel has
 * already painted. Throwaway, like the controls it exists for.
 */

import { createSignal } from 'solid-js';

const [sessions, setSessions] = createSignal<Record<string, string>>({});

/** Record the session a channel's log named. */
export function rememberDebugSessionId(
  channelId: string,
  agentSessionId: string | null | undefined
): void {
  if (!agentSessionId) return;
  setSessions((current) =>
    current[channelId] === agentSessionId
      ? current
      : { ...current, [channelId]: agentSessionId }
  );
}

/** The session showing in a channel, if its log has been fetched. */
export function agentSessionIdForChannel(
  channelId: string
): string | undefined {
  return sessions()[channelId];
}
