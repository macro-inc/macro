import { SLACK_PIPEDREAM_SLUGS } from '@core/pipedream/slugs';
import LinearIcon from '@icon/linear-color.svg';
import GithubIcon from '@icon/mcp-github.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/slack-color.svg';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import type { ProviderId } from './model';

export const PIPEDREAM_BROWSE_HIDDEN_SLUGS: ReadonlySet<string> = new Set([
  // Featured providers have their own rows.
  'github',
  'linear',
  'notion',
  'slack',
  ...SLACK_PIPEDREAM_SLUGS,
  'cursor',
  // Macro syncs email and calendars natively (Settings → Integrations → Email).
  'gmail',
  'google_calendar',
  'google_sheets',
]);

export function providerIcon(id: ProviderId): JSX.Element {
  return match(id)
    .with('github', () => <GithubIcon />)
    .with('linear', () => <LinearIcon />)
    .with('notion', () => <NotionIcon />)
    .with('slack', () => <SlackIcon />)
    .exhaustive();
}
