import { providerIdentity } from '../identity';
import type { ChatProvider } from '../index';
import { markdownToSlack, slackToMarkdown } from './formatting';

export const slackProvider: ChatProvider = {
  ...providerIdentity('slack'),
  badgeClass: 'bg-[#4A154B] text-[#fff]',
  formatting: {
    toMarkdown: slackToMarkdown,
    fromMarkdown: markdownToSlack,
  },
  // Slack ended the session (signed out, revoked) or the owner disconnected.
  disconnected: {
    note: 'Your Slack session ended. Sign in again to reply',
    action: 'Sign in to Slack',
  },
  // Adding a chat imports its recent history; each import reaches further back.
  historyImport: {
    states: ['partial'],
    prompt: 'Earlier messages are still in Slack.',
  },
  // Text, formatting, files and mentions of the conversation's members;
  // nothing Macro-only.
  composerFeatures: {
    mentions: 'participants',
    createItems: false,
    gifs: false,
    richBlocks: false,
  },
};
