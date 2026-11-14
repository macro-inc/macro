import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import type { ChatBackfill } from '../core/chat';
import type { Mention } from '../core/rich';
import type { ProviderIdentity } from './identity';
import { slackProvider } from './slack';
import { whatsappProvider } from './whatsapp';

/**
 * What the generic conversation needs from the service a chat lives in.
 * Generic code reads a provider only through `chatProvider`.
 */
export type ChatProvider = ProviderIdentity & {
  /** The header badge's brand colors behind `icon`. */
  badgeClass: string;
  /** The service's text formatting at the display and send edges. */
  formatting: {
    /** A received body as Markdown for the shared message renderer. */
    toMarkdown: (body: string, mentions?: Mention[]) => string;
    /** Composer Markdown as the text the service sends. */
    fromMarkdown: (markdown: string) => string;
  };
  /**
   * When the chat's owner can import earlier messages from the chat view: in
   * these backfill states, with this line beside the Import button.
   */
  historyImport: { states: ChatBackfill['state'][]; prompt: string };
  /**
   * The composer's line and button when the viewer's account at the provider
   * is no longer connected (`sendReason: disconnected`).
   */
  disconnected: { note: string; action: string };
  /** What the shared composer offers beyond text and files. */
  composerFeatures: NonNullable<ChannelInputProps['features']>;
};

const PROVIDERS: Record<ExternalChatProvider, ChatProvider> = {
  whatsapp: whatsappProvider,
  slack: slackProvider,
};

export function chatProvider(provider: ExternalChatProvider): ChatProvider {
  return PROVIDERS[provider];
}
