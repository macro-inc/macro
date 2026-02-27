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

export function getInnerRailBottom(isReplying: boolean): string {
  return isReplying ? '0px' : 'calc(var(--user-icon-width) / 2 + 0.5rem)';
}
