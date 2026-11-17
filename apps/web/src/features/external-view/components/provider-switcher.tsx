import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { Tabs } from '@ui';
import { providerIdentity } from '../../external-chat/providers/identity';

/**
 * Picks the provider whose page External shows, where touch has no sidebar to
 * pick it from. Each option counts its unread chats, which the other pages
 * hold.
 */
export function ProviderSwitcher(props: {
  /** Enabled providers, in sidebar order. */
  providers: ExternalChatProvider[];
  selected: ExternalChatProvider;
  unread: (provider: ExternalChatProvider) => number;
  onSelect: (provider: ExternalChatProvider) => void;
}) {
  return (
    <Tabs
      aria-label="External apps"
      options={props.providers.map((provider) => ({
        value: provider,
        label: providerIdentity(provider).label,
        icon: providerIdentity(provider).icon,
        count: props.unread(provider) || undefined,
      }))}
      value={props.selected}
      onChange={props.onSelect}
      fullWidth
      touch="segmented"
    />
  );
}
