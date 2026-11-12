/**
 * Every person who signs up gets a private support channel with the Macro
 * team, owned by them and named `Macro Support x <email local part>`
 * (`support_channel_name` in the authentication service's create-user
 * webhook). Nothing else marks it, so it is found by that name and owner.
 * Macro team members belong to many customers' support channels and own
 * none; for them the link opens the most recently active one, so the team
 * sees what customers see and lands where support is happening.
 */
const SUPPORT_CHANNEL_NAME_PREFIX = 'Macro Support x ';

type ChannelSummary = {
  id: string;
  name?: string | null;
  owner_id: string;
  updated_at?: string;
};

/** The support channel the link opens: the person's own, else their most recently active one. */
export function findSupportChannelId(
  channels: readonly ChannelSummary[],
  userId: string | undefined
): string | undefined {
  if (!userId) return undefined;

  const supportChannels = channels.filter((channel) =>
    channel.name?.startsWith(SUPPORT_CHANNEL_NAME_PREFIX)
  );
  const own = supportChannels.find((channel) => channel.owner_id === userId);
  if (own) return own.id;

  return supportChannels.reduce<ChannelSummary | undefined>(
    (latest, channel) =>
      !latest || updatedAt(channel) > updatedAt(latest) ? channel : latest,
    undefined
  )?.id;
}

function updatedAt(channel: ChannelSummary): number {
  return channel.updated_at ? Date.parse(channel.updated_at) : 0;
}
