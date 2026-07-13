import type { CombinedRecipientItem } from '@core/user';

type UserDestination = {
  type: 'users';
  users: string[];
};

type ChannelDestination = {
  type: 'channel';
  id: string;
};

type Destination = UserDestination | ChannelDestination;

type DestinationType<T extends CombinedRecipientItem> =
  T extends CombinedRecipientItem<'channel'>
    ? Extract<T, CombinedRecipientItem<'channel'>> extends T
      ? ChannelDestination
      : Destination
    : UserDestination;

export function getDestinationFromOptions<T extends CombinedRecipientItem>(
  options: T[]
): DestinationType<T> {
  let maybeChannel = options.find((o) => o.kind === 'channel');
  if (maybeChannel) {
    return {
      type: 'channel',
      id: maybeChannel.id,
    } as any;
  }

  const userIds = options
    .filter((o) => {
      if (o.kind === 'custom') {
        return !o.data.invalid;
      }
      return true;
    })
    .map((o) => {
      if (o.kind === 'channel') return;
      return o.id;
    })
    .filter((id) => id != null);

  return {
    type: 'users',
    users: userIds,
  } as any;
}
