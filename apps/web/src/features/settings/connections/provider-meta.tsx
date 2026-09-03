import GoogleIcon from '@icon/mcp-google.svg';
import GithubIcon from '@icon/mcp-github.svg';
import LinearIcon from '@icon/mcp-linear.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/mcp-slack.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import type { JSX } from 'solid-js';
import type { ProviderId } from './model';

export type FeaturedStarter = {
  id: Exclude<ProviderId, 'other'>;
  name: string;
  note: string;
};

export const EMPTY_STARTERS: FeaturedStarter[] = [
  {
    id: 'google',
    name: 'Google',
    note: 'Connect Gmail and Calendar to Macro.',
  },
  {
    id: 'github',
    name: 'GitHub',
    note: 'Bring your repos into your unified workspace.',
  },
  {
    id: 'linear',
    name: 'Linear',
    note: 'Bring your issues into your unified workspace.',
  },
  {
    id: 'notion',
    name: 'Notion',
    note: 'Bring your docs and wikis into your unified workspace.',
  },
  {
    id: 'slack',
    name: 'Slack',
    note: 'Bring your conversations into your unified workspace.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    note: 'Use your Cursor account to run agent sessions in Macro.',
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
  switch (id) {
    case 'google':
      return <GoogleIcon />;
    case 'github':
      return <GithubIcon />;
    case 'linear':
      return <LinearIcon />;
    case 'notion':
      return <NotionIcon />;
    case 'slack':
      return <SlackIcon />;
    case 'cursor':
      return <CursorIcon />;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
