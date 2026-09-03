import GithubIcon from '@icon/mcp-github.svg';
import GoogleIcon from '@icon/mcp-google.svg';
import LinearIcon from '@icon/mcp-linear.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/mcp-slack.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { GOOGLE_PROVIDER_NOTE, type ProviderId } from './model';

export type FeaturedStarter = {
  id: Exclude<ProviderId, 'other'>;
  name: string;
  note: string;
};

export const EMPTY_STARTERS: FeaturedStarter[] = [
  {
    id: 'google',
    name: 'Google',
    note: GOOGLE_PROVIDER_NOTE,
  },
  {
    id: 'github',
    name: 'GitHub',
    note: 'Account, team, and AI',
  },
  {
    id: 'linear',
    name: 'Linear',
    note: 'Issues for Macro AI',
  },
  {
    id: 'notion',
    name: 'Notion',
    note: 'Search pages with Macro AI',
  },
  {
    id: 'slack',
    name: 'Slack',
    note: 'Conversations for Macro AI',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    note: 'Run @cursor sessions on your Cursor account',
  },
];

export const FEATURED_DISCOVER = EMPTY_STARTERS;

/**
 * Pipedream catalog slugs Macro already covers outside Browse.
 * Featured keeps Google / GitHub / Linear / Notion / Slack / Cursor.
 * Browse hides these so users do not get a second connect path.
 *
 * `gmail` and `google_calendar` are first-party Google aliases. Featured
 * provider ids that match catalog slugs (`github`, `linear`, …) are included
 * too. Drive/Sheets stay visible.
 */
export const PIPEDREAM_BROWSE_HIDDEN_SLUGS: ReadonlySet<string> = new Set([
  ...FEATURED_DISCOVER.map((item) => item.id),
  'gmail',
  'google_calendar',
]);

export function isPipedreamBrowseHidden(appSlug: string): boolean {
  return PIPEDREAM_BROWSE_HIDDEN_SLUGS.has(appSlug);
}

export function providerIcon(id: Exclude<ProviderId, 'other'>): JSX.Element {
  return match(id)
    .with('google', () => <GoogleIcon />)
    .with('github', () => <GithubIcon />)
    .with('linear', () => <LinearIcon />)
    .with('notion', () => <NotionIcon />)
    .with('slack', () => <SlackIcon />)
    .with('cursor', () => <CursorIcon />)
    .exhaustive();
}
