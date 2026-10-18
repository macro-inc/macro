import type { ChannelInteraction } from '@app/features/meta-messaging/core/conversation';

/** Calls require a resolved internal channel and remain unavailable in agent DMs. */
export function channelCallsAllowed(
  interaction: ChannelInteraction,
  isAgentDm: boolean
): boolean {
  return interaction.kind === 'internal' && !isAgentDm;
}
