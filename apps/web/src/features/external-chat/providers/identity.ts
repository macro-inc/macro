import SlackLogo from '@phosphor/slack-logo.svg';
import WhatsappLogo from '@phosphor/whatsapp-logo.svg';
import SlackLogoBold from '@phosphor-icons/core/bold/slack-logo-bold.svg';
import WhatsappLogoBold from '@phosphor-icons/core/bold/whatsapp-logo-bold.svg';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import type { Component, JSX } from 'solid-js';

type Icon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** How a provider is named and drawn, apart from its formatting code. */
export type ProviderIdentity = {
  /** The service's name in copy: "Connect WhatsApp". */
  label: string;
  icon: Icon;
  boldIcon: Icon;
  /** Chat-list section titles: a provider's own word for its group chats. */
  sectionLabels: { direct: string; groups: string };
};

/**
 * Names and logos alone, for surfaces outside the conversation (entity icons,
 * notifications) that shouldn't load the registry's formatting code.
 */
const IDENTITIES: Record<ExternalChatProvider, ProviderIdentity> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: WhatsappLogo,
    boldIcon: WhatsappLogoBold,
    sectionLabels: { direct: 'Direct messages', groups: 'Groups' },
  },
  slack: {
    label: 'Slack',
    icon: SlackLogo,
    boldIcon: SlackLogoBold,
    sectionLabels: { direct: 'Direct messages', groups: 'Channels' },
  },
};

export function providerIdentity(
  provider: ExternalChatProvider
): ProviderIdentity {
  return IDENTITIES[provider];
}
