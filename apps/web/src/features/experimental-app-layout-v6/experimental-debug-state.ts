import { createSignal } from 'solid-js';

/** Mock Inbox notification state controlled by the Experimental v6 debugger. */
export const [mockInboxNotification, setMockInboxNotification] =
  createSignal(false);

/** Mock quick-agent notification state controlled by the debugger. */
export const [mockAgentNotification, setMockAgentNotification] =
  createSignal(false);

/** Mock quick-agent loading state controlled by the debugger. */
export const [mockAgentLoading, setMockAgentLoading] = createSignal(false);
