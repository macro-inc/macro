export const threadOffsetX =
  'calc(var(--left-of-connector) + var(--thread-shift) - var(--user-icon-width) / 2 - var(--message-padding-x))';

export const innerRailX =
  'calc(var(--left-of-connector) + var(--thread-shift))';

export const innerRailTop =
  'calc(var(--regular-message-padding-t) + var(--thread-padding-y))';

export const threadConnectorStyle = {
  left: 'var(--left-of-channel-rail)',
  top: 'calc(var(--regular-message-padding-t) + var(--thread-padding-y))',
  width:
    'calc(var(--thread-shift) - var(--user-icon-width) / 2 - var(--channel-rail-clearance))',
} as const;

/** Default composer alignment for standalone thread renderers. */
export const replyInputOffsetX =
  'calc(var(--user-icon-width) + var(--message-padding-x))';

/** Channel composers replace the reply action, so they share its anchor. */
export const channelReplyInputOffsetX = 'var(--message-padding-x)';

export function getInnerRailBottom(isReplying: boolean): string {
  if (!isReplying) return 'calc(var(--user-icon-width) / 2 + 0.5rem)';
  // When replying, the rail stops above the reply-input connector
  // (roughly at 50% of the reply input area).
  return 'calc(var(--user-icon-width) * 2 + 1rem)';
}
