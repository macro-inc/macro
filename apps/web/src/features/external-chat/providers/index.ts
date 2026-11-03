import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import type { Mention } from '../core/rich';
import type { ProviderIdentity } from './identity';
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
  /** What the shared composer offers beyond text and files. */
  composerFeatures: NonNullable<ChannelInputProps['features']>;
};

const PROVIDERS: Record<ExternalChatProvider, ChatProvider> = {
  whatsapp: whatsappProvider,
};

export function chatProvider(provider: ExternalChatProvider): ChatProvider {
  return PROVIDERS[provider];
}
