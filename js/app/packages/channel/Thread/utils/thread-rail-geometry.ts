export const replyCenterOffsetX =
  'calc(var(--user-icon-width) / 2 + var(--body-padding))';

export const threadOffsetX =
  'calc(var(--left-of-connector) + var(--thread-shift) - var(--user-icon-width) / 2 - var(--body-padding))';

export const innerRailX =
  'calc(var(--left-of-connector) + var(--thread-shift))';

export const innerRailTop =
  'calc(var(--body-padding) + var(--user-icon-width) / 2)';

export const threadConnectorStyle = {
  left: 'calc(var(--left-of-connector) - 8px)',
  top: 'calc(var(--body-padding) + var(--user-icon-width) / 2 - 20px)',
  width: 'calc(var(--thread-shift) + 2px)',
  height: '18px',
} as const;

/** Left offset for the reply-input wrapper, placing it icon-width/2 right of the inner rail. */
export const replyInputOffsetX =
  'calc(var(--user-icon-width) / 2 + var(--body-padding) + var(--user-icon-width) / 2)';

export function getInnerRailBottom(isReplying: boolean): string {
  if (!isReplying) return 'calc(var(--user-icon-width) / 2 + 0.5rem)';
  // When replying, the rail stops above the reply-input connector
  // (roughly at 50% of the reply input area).
  return 'calc(var(--user-icon-width) * 2 + 1rem)';
}
