/**
 * Which Homes desktop shows. `both` puts New Home beside old Home, in
 * Notifications' place; `new-only` puts New Home in old Home's place.
 */
export type NewHomeMode = 'off' | 'both' | 'new-only';

/** New Home's two lists. */
export type NewHomeTab = 'recent' | 'notifications';

type FlagState = { loading: boolean; enabled: boolean };

/**
 * The mode the flags select, or undefined while one that decides it loads.
 * Touch devices keep today's Home and Notifications in every mode, and
 * `disable-old-home` alone changes nothing, so no one is left without a Home.
 */
export function resolveNewHomeMode(input: {
  touch: boolean;
  enableNewHome: FlagState;
  disableOldHome: FlagState;
}): NewHomeMode | undefined {
  if (input.touch) return 'off';
  if (input.enableNewHome.loading) return undefined;
  if (!input.enableNewHome.enabled) return 'off';
  if (input.disableOldHome.loading) return undefined;
  return input.disableOldHome.enabled ? 'new-only' : 'both';
}

export function parseNewHomeTab(value: string | null): NewHomeTab {
  return value === 'notifications' ? 'notifications' : 'recent';
}

/**
 * Whether a rail item stands for what a split shows, where New Home decides
 * it: `/home` on the Recent tab and `/notifications` are New Home's, and once
 * old Home is off every `/home` is. Undefined leaves the item to the rail.
 */
export function newHomeNavActive(input: {
  itemId: string;
  mode: NewHomeMode | undefined;
  /** The split's view: a component's id, such as `home`. */
  viewId: string | undefined;
  /** On a `/home` split, the tab its URL names. */
  recentTab: boolean;
}): boolean | undefined {
  const { itemId, mode, viewId } = input;
  if (mode !== 'both' && mode !== 'new-only') return undefined;
  const newHomeShown =
    viewId === 'notifications' ||
    (viewId === 'home' && (mode === 'new-only' || input.recentTab));
  if (mode === 'new-only') return itemId === 'home' ? newHomeShown : undefined;
  if (itemId === 'new-home') return newHomeShown;
  if (itemId === 'home') return viewId === 'home' && !newHomeShown;
  return undefined;
}

/** Which Home a `/home` split shows. */
export type HomeRouteShows = 'old' | 'new' | 'pending';

/**
 * New Home's Recent is `/home` on the Recent tab, and every `/home` once old
 * Home is off. A Recent link waits for the flags; any other `/home` shows
 * old Home meanwhile, as it always has.
 */
export function homeRouteShows(input: {
  mode: NewHomeMode | undefined;
  recentTab: boolean;
}): HomeRouteShows {
  const { mode, recentTab } = input;
  if (mode === undefined) return recentTab ? 'pending' : 'old';
  if (mode === 'off') return 'old';
  if (mode === 'both') return recentTab ? 'new' : 'old';
  return 'new';
}
