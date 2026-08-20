import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';

/** Drawer id for the "thread this session was spawned from" drawer. */
export const ORIGIN_THREAD_DRAWER_ID = 'agent-origin-thread';

/** A channel-thread reference: the channel plus the thread's root message. */
export type OriginThreadRef = { channelId: string; messageId: string };

/** The thread this session was spawned from, when renderable. */
export function sessionOriginThread(
  session: AgentSessionResponse | undefined
): OriginThreadRef | undefined {
  const messageId = session?.threadId;
  const channelId = session?.threadChannelId;
  if (!messageId || !channelId) return undefined;
  return { channelId, messageId };
}
