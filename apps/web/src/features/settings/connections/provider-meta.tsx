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
  {
    id: 'google',
    name: 'Google',
    note: 'Read, organize, and act on your email.',
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

export const FEATURED_DISCOVER: FeaturedStarter[] = [
  {
    id: 'google',
    name: 'Google',
    note: 'Read, organize, and act on your email.',
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
