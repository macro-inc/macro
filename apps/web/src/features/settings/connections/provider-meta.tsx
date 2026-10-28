import { SLACK_PIPEDREAM_SLUGS } from '@core/pipedream/slugs';
import GithubIcon from '@icon/mcp-github.svg';
import LinearIcon from '@icon/mcp-linear.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/mcp-slack.svg';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import type { ProviderId } from './model';

export type FeaturedStarter = {
  id: ProviderId;
  name: string;
};

export const EMPTY_STARTERS: FeaturedStarter[] = [
  { id: 'github', name: 'GitHub' },
  { id: 'linear', name: 'Linear' },
  { id: 'notion', name: 'Notion' },
  { id: 'slack', name: 'Slack' },
];

export const PIPEDREAM_BROWSE_HIDDEN_SLUGS: ReadonlySet<string> = new Set([
  ...EMPTY_STARTERS.map((item) => item.id),
  ...SLACK_PIPEDREAM_SLUGS,
  'cursor',
  // Macro syncs email and calendars natively (Settings → Integrations → Email).
  'gmail',
  'google_calendar',
  'google_sheets',
]);

export function isPipedreamBrowseHidden(appSlug: string): boolean {
  return PIPEDREAM_BROWSE_HIDDEN_SLUGS.has(appSlug);
}

export function providerIcon(id: ProviderId): JSX.Element {
  return match(id)
    .with('github', () => <GithubIcon />)
    .with('linear', () => <LinearIcon />)
    .with('notion', () => <NotionIcon />)
    .with('slack', () => <SlackIcon />)
    .exhaustive();
}
