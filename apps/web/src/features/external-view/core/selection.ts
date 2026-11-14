import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';

/**
 * The provider whose page External shows: the one the latest navigation
 * named (a sidebar click, Back from a chat, an account notification) while
 * its flag is on, else the first enabled one.
 */
export function selectedProvider(
  routed: ExternalChatProvider | undefined,
  enabled: ExternalChatProvider[]
): ExternalChatProvider | undefined {
  return routed && enabled.includes(routed) ? routed : enabled[0];
}
