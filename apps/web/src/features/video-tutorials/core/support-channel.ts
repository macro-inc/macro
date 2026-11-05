/**
 * Every person who signs up gets a private support channel with the Macro
 * team, owned by them and named `Macro Support x <email local part>`
 * (`support_channel_name` in the authentication service's create-user
 * webhook). Nothing else marks it, so it is found by that name and owner.
 * Macro team members belong to many customers' support channels; owning one
 * is the only sign that it was created for this person.
 */
const SUPPORT_CHANNEL_NAME_PREFIX = 'Macro Support x ';

type ChannelSummary = {
  id: string;
  name?: string | null;
  owner_id: string;
};

/** The id of the person's own support channel, if they still have it. */
export function findSupportChannelId(
  channels: readonly ChannelSummary[],
  userId: string | undefined
): string | undefined {
  if (!userId) return undefined;

  return channels.find(
    (channel) =>
      channel.owner_id === userId &&
      channel.name?.startsWith(SUPPORT_CHANNEL_NAME_PREFIX)
  )?.id;
}
