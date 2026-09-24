import { pipedreamAppAvailableInEnv } from '@core/component/AI/constant/mcpServers';
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
  note: string;
};

export const EMPTY_STARTERS: FeaturedStarter[] = [
  {
    id: 'github',
    name: 'GitHub',
    note: 'Repos, pull requests, and issues for Macro AI',
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
];

export const PIPEDREAM_BROWSE_HIDDEN_SLUGS: ReadonlySet<string> = new Set([
  ...EMPTY_STARTERS.map((item) => item.id),
  'cursor',
]);

export const availableStarters = () =>
  EMPTY_STARTERS.filter((item) => pipedreamAppAvailableInEnv(item.id));

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
