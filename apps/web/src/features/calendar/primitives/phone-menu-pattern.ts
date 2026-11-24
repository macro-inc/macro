export const PHONE_MENU_IDS = [
  'call',
  'decline',
  'calendar',
  'visibility',
  'reminders',
  'time-zone',
  'repeat',
  'custom-repeat',
  'people',
] as const;

export type PhoneMenuId = (typeof PHONE_MENU_IDS)[number];

export type PhoneMenuPattern = 'inline' | 'page';

/** Search, multi-step flows, and wrapping labels require the same-sheet page. */
export function phoneMenuPattern(
  menu: PhoneMenuId,
  options: { count?: number; labelsFit?: boolean } = {}
): PhoneMenuPattern {
  if (menu === 'call' || menu === 'visibility' || menu === 'decline')
    return 'inline';
  if (menu === 'calendar')
    return (options.count ?? 0) <= 5 && options.labelsFit === true
      ? 'inline'
      : 'page';
  return 'page';
}
