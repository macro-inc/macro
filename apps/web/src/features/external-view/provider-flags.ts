import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableWhatsappLinked,
  type RemoteFlag,
} from '@core/constant/featureFlags';
import { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { type Accessor, createMemo } from 'solid-js';

/** Each provider's rollout gate: its page, its chats and its sidebar entry. */
export const PROVIDER_FLAGS: Record<ExternalChatProvider, RemoteFlag> = {
  whatsapp: enableWhatsappLinked,
};

export type EnabledProviders = {
  /** Some provider's flag is still resolving. */
  loading: boolean;
  /** Providers whose flag is on, in sidebar order. */
  providers: ExternalChatProvider[];
};

/** Providers whose flag is on. External exists while any one is. */
export function useEnabledProviders(): Accessor<EnabledProviders> {
  const flags = Object.values(ExternalChatProvider).map(
    (provider) => [provider, useFeatureFlag(PROVIDER_FLAGS[provider])] as const
  );
  return createMemo(() => ({
    loading: flags.some(([, flag]) => flag().loading),
    providers: flags
      .filter(([, flag]) => flag().enabled)
      .map(([provider]) => provider),
  }));
}
