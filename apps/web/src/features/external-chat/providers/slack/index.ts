import SlackLogo from '@phosphor/slack-logo.svg';
import SlackLogoBold from '@phosphor-icons/core/bold/slack-logo-bold.svg';
import type { ChatProvider } from '../index';
import { markdownToSlack, slackToMarkdown } from './formatting';

// TODO(slack-web): spread `providerIdentity('slack')` and register in
// `PROVIDERS` once the generated `ExternalChatProvider` has `slack`.
export const slackProvider: ChatProvider = {
  label: 'Slack',
  icon: SlackLogo,
  boldIcon: SlackLogoBold,
  badgeClass: 'bg-[#4A154B] text-[#fff]',
  formatting: {
    toMarkdown: slackToMarkdown,
    fromMarkdown: markdownToSlack,
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
