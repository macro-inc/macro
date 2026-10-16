import type { EntityActionViewContext } from '@app/features/next-soup/actions';

/**
 * How entity actions behave for the channel family: a conversation is never
 * marked done and has no sender to bucket. Shared by every channel surface —
 * the rail rows, the mobile list, and the detail header's title menu — so
 * they offer one set of actions.
 */
export const CHANNEL_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  supportsOpenInNewSplit: false,
  senderBucket: undefined,
};
