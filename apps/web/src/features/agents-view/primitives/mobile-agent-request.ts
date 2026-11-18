import { createSignal } from 'solid-js';
import type { AgentKind } from '../core/agent-kind';

/** A one-shot request owned by the accessory mount, independent of the list mount. */
const [request, setRequest] = createSignal<{
  userId: string;
  agentId: string;
  kind: AgentKind;
  request: string;
}>();
export const mobileAgentRequest = {
  forUser: (userId: string | undefined) =>
    userId && request()?.userId === userId ? request() : undefined,
  select: (userId: string | undefined, agentId: string, kind: AgentKind) => {
    if (userId)
      setRequest({ userId, agentId, kind, request: crypto.randomUUID() });
  },
};
