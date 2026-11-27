import { createSignal } from 'solid-js';
import type { AgentKind } from '../core/agent-kind';

/** A one-shot request owned by the accessory mount, independent of the list mount. */
const [request, setRequest] = createSignal<{
  userId: string;
  agentId: string;
  kind: AgentKind;
  request: string;
}>();
let composerFocus: { userId: string; focus: () => void } | undefined;

export const mobileAgentRequest = {
  forUser: (userId: string | undefined) =>
    userId && request()?.userId === userId ? request() : undefined,
  select: (userId: string | undefined, agentId: string, kind: AgentKind) => {
    if (!userId) return;
    setRequest({ userId, agentId, kind, request: crypto.randomUUID() });
    // iOS opens the keyboard only when focus happens inside the bubble tap.
    if (composerFocus?.userId === userId) composerFocus.focus();
  },
  focus: (userId: string | undefined) => {
    if (userId && composerFocus?.userId === userId) composerFocus.focus();
  },
  registerFocus: (userId: string, focus: () => void) => {
    const registration = { userId, focus };
    composerFocus = registration;
    return () => {
      if (composerFocus === registration) composerFocus = undefined;
    };
  },
};
