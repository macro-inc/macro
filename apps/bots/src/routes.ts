export const brainViews = {
  overview: 'Overview',
  activity: 'Activity',
  email: 'Email',
  access: 'Access',
};

export const towerViews = {
  fleet: 'Fleet',
  passwords: 'Passwords',
  billing: 'Billing',
};

export function ownView<T extends string>(
  views: Record<T, string>,
  value: string
): value is T {
  return Object.hasOwn(views, value);
}

export function brainPath(
  bot: string,
  view: keyof typeof brainViews = 'overview'
): string {
  return scopedBrainPath('sample-team', bot, view);
}

export function scopedBrainPath(
  team: string,
  bot: string,
  view: keyof typeof brainViews = 'overview'
): string {
  return `/teams/${encodeURIComponent(team)}/bots/${encodeURIComponent(bot)}/${view}`;
}
