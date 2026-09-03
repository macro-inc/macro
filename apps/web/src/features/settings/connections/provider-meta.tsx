import GithubIcon from '@icon/mcp-github.svg';
import GmailIcon from '@icon/mcp-gmail.svg';
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
  { id: 'google', name: 'Google', note: 'Mail and calendar in Macro' },
  { id: 'github', name: 'GitHub', note: 'Account, team, and AI' },
  { id: 'linear', name: 'Linear', note: 'Issues for Macro AI' },
  { id: 'notion', name: 'Notion', note: 'Search pages with Macro AI' },
  { id: 'slack', name: 'Slack', note: 'Conversations for Macro AI' },
  {
    id: 'cursor',
    name: 'Cursor',
    note: 'Run @cursor sessions on your Cursor account',
  },
];

export const FEATURED_DISCOVER: FeaturedStarter[] = [
  { id: 'google', name: 'Google', note: 'Email and Calendar in Macro' },
  { id: 'github', name: 'GitHub', note: 'Account, team sync, and Macro AI' },
  { id: 'linear', name: 'Linear', note: 'Issues for Macro AI' },
  { id: 'slack', name: 'Slack', note: 'Conversations for Macro AI' },
  {
    id: 'cursor',
    name: 'Cursor',
    note: 'Run @cursor coding sessions from Macro',
  },
];

export function providerIcon(id: Exclude<ProviderId, 'other'>): JSX.Element {
  switch (id) {
    case 'google':
      return <GmailIcon />;
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
