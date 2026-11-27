export const brainViews = {
  overview: 'Overview',
  activity: 'Activity',
  email: 'Email',
  access: 'Access',
};

export type BrainView = keyof typeof brainViews;

export const fixtureTeam = 'sample-team';
export const fixtureTeamName = 'Northstar Design';

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

export function brainPath(bot: string, view: BrainView = 'overview'): string {
  return scopedBrainPath(fixtureTeam, bot, view);
}

export function scopedBrainPath(
  team: string,
  bot: string,
  view: BrainView = 'overview'
): string {
  return `/teams/${encodeURIComponent(team)}/bots/${encodeURIComponent(bot)}/${view}`;
}

export function brainEntryPath(team: string, bot: string, entry: string) {
  return `${scopedBrainPath(team, bot, 'activity')}/${encodeURIComponent(entry)}`;
}

const brainId = /^[a-zA-Z0-9][a-zA-Z0-9_|-]*$/;

function decodeBrainId(segment: string | undefined) {
  if (!segment) return;

  try {
    const id = decodeURIComponent(segment);
    if (brainId.test(id) && encodeURIComponent(id) === segment) return id;
  } catch {
    // Malformed escape sequences are unavailable routes.
  }
}

export function parseBrainRoute(
  pathname: string,
  params: Record<'team' | 'bot' | 'view' | 'entry', string | undefined>
) {
  const team = decodeBrainId(params.team);
  const bot = decodeBrainId(params.bot);
  const { view } = params;
  if (!team || !bot || !view || !ownView(brainViews, view)) return;

  const entry = decodeBrainId(params.entry);
  if (params.entry !== undefined) {
    if (
      view !== 'activity' ||
      !entry ||
      pathname !== brainEntryPath(team, bot, entry)
    )
      return;
  } else if (pathname !== scopedBrainPath(team, bot, view)) return;

  return { team, agent: bot, view, entry };
}
