import { useChannelsContext } from '@core/context/channels';
import {
  type CombinedRecipientItem,
  recipientEntityMapper,
  useContacts,
  useIsConnectedSecondaryInbox,
} from '@core/user';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';

// 'user' type will include 'contact' for use combined recipients hook
type KindExpansion = {
  user: 'user' | 'contact';
  channel: 'channel';
};

type ConditionalProperty<
  K extends 'user' | 'channel',
  Target extends 'user' | 'channel',
  T,
> = Extract<K, Target> extends never ? undefined : T;

type UseCombinedRecipients<K extends 'user' | 'channel'> = {
  users: ConditionalProperty<
    K,
    'user',
    Accessor<CombinedRecipientItem<KindExpansion['user']>[]>
  >;
  channels: ConditionalProperty<
    K,
    'channel',
    Accessor<CombinedRecipientItem<KindExpansion['channel']>[]>
  >;
  all: Accessor<CombinedRecipientItem<KindExpansion[K]>[]>;
};

// Lazy: pickers that stay closed (e.g. the always-mounted create-channel and
// share modals) never project every contact and channel into options.
const useCombinedRecipientsRoot = () => {
  const contacts = useContacts();
  const channelsContext = useChannelsContext();
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();

  const userContactEntities = createLazyMemo<CombinedRecipientItem<'user'>[]>(
    () =>
      contacts()
        .filter((contact) => !isConnectedSecondaryInbox(contact.id))
        .map(recipientEntityMapper('user'))
  );

  const channelsWithParticipants = createLazyMemo<
    CombinedRecipientItem<'channel'>[]
  >(() =>
    channelsContext
      .channels()
      .filter((channel) => channel.participants.length > 2)
      .map(recipientEntityMapper('channel'))
  );

  return { users: userContactEntities, channels: channelsWithParticipants };
};

export function useCombinedRecipients<
  K extends 'user' | 'channel' = 'user' | 'channel',
>(entities?: K[]): UseCombinedRecipients<K> {
  const kinds = entities ?? ['user', 'channel'];

  const { users, channels } = useCombinedRecipientsRoot();

  const includeUsers = kinds.includes('user');
  const includeChannels = kinds.includes('channel');

  const allRecipients = createLazyMemo(() => {
    const options: CombinedRecipientItem[] = [];
    if (includeUsers) {
      options.push(...users());
    }
    if (includeChannels) {
      options.push(...channels());
    }
    return options as CombinedRecipientItem<K>[];
  });

  return {
    users: includeUsers ? users : undefined,
    channels: includeChannels ? channels : undefined,
    all: allRecipients,
  } as unknown as UseCombinedRecipients<K>;
}
