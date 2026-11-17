import { providerIdentity } from '../identity';
import type { ChatProvider } from '../index';
import { markdownToWhatsApp, whatsappToMarkdown } from './formatting';

export const whatsappProvider: ChatProvider = {
  ...providerIdentity('whatsapp'),
  badgeClass: 'bg-[#25D366] text-[#fff]',
  formatting: {
    toMarkdown: whatsappToMarkdown,
    fromMarkdown: markdownToWhatsApp,
  },
  disconnected: {
    note: 'Connect your WhatsApp to reply',
    action: 'Connect WhatsApp',
  },
  historyImport: {
    states: ['waiting_for_phone'],
    prompt: 'Open WhatsApp on your phone to import earlier messages.',
  },
  // Text, formatting, files and mentions of the chat's own participants;
  // nothing Macro-only.
  composerFeatures: {
    mentions: 'participants',
    createItems: false,
    gifs: false,
    richBlocks: false,
  },
};
