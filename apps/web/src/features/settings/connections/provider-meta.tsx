import LinearIcon from '@icon/linear-color.svg';
import GithubIcon from '@icon/mcp-github.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/slack-color.svg';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { GRANOLA_APP_SLUG } from '../../granola-connect/core/granola';
import type { ProviderId } from './model';

/**
 * Apps outside the featured providers whose connection the Integrations page
 * manages from a row of their own, so they never get a second, generic row.
 */
export const OWN_ROW_APPS: ReadonlySet<string> = new Set([GRANOLA_APP_SLUG]);

/** Catalog apps the Integrations page never lists among apps to connect. */
export const CATALOG_HIDDEN_SLUGS: ReadonlySet<string> = new Set([
  // Featured providers have their own rows.
  'github',
  'linear',
  'notion',
  'slack',
  GRANOLA_APP_SLUG,
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
