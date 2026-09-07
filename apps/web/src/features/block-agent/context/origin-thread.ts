import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import type { MessageParent } from '@service-storage/messages';

/** Drawer id for the "thread this session was spawned from" drawer. */
export const ORIGIN_THREAD_DRAWER_ID = 'agent-origin-thread';

/** The originating parent and canonical root message. */
export type OriginThreadRef = { parent: MessageParent; messageId: string };

/** The thread this session was spawned from, when renderable. */
export function sessionOriginThread(
  session: AgentSessionResponse | undefined
): OriginThreadRef | undefined {
  const messageId = session?.threadId;
  const parent = session?.threadParent;
  if (!messageId || !parent) return undefined;
  return { parent, messageId };
}
