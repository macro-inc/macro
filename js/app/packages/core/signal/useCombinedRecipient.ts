import { useChannelsContext } from '@core/component/ChannelsProvider';
import {
  type CombinedRecipientItem,
  isPersonEmailContact,
  recipientEntityMapper,
  useContacts,
  useEmailContacts,
  useOrganizationUsers,
} from '@core/user';
import { type Accessor, createMemo } from 'solid-js';

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

const useCombinedRecipientsRoot = () => {
  const organizationUsers = useOrganizationUsers();
  const contacts = useContacts();
  const emailContacts = useEmailContacts();
  const channelsContext = useChannelsContext();

  // TODO: merge data sources to get correct values vs. just overwriting by latest
  const deduplicateUsersByEmail = (
    items: CombinedRecipientItem<'user' | 'contact'>[]
  ) => {
    const userMap = new Map<
      string,
      CombinedRecipientItem<'user' | 'contact'>
    >();
    for (const item of items) {
      userMap.set(item.data.email, item);
    }
    return Array.from(userMap.values());
  };

  const organizationUserEntities = createMemo<CombinedRecipientItem<'user'>[]>(
    () => organizationUsers().map(recipientEntityMapper('user'))
  );

  const userContactEntities = createMemo<CombinedRecipientItem<'user'>[]>(() =>
    contacts().map(recipientEntityMapper('user'))
  );

  const emailUsers = createMemo<CombinedRecipientItem<'contact'>[]>(() => {
    return emailContacts()
      .filter(isPersonEmailContact)
      .map(recipientEntityMapper('contact'));
  });

  const deduplicatedUsers = createMemo(() => {
    return deduplicateUsersByEmail([
      ...emailUsers(),
      ...userContactEntities(),
      ...organizationUserEntities(),
    ]);
  });

  const channelsWithParticipants = createMemo<
    CombinedRecipientItem<'channel'>[]
  >(() =>
    channelsContext
      .channels()
      .filter((channel) => channel.participants.length > 2)
      .map(recipientEntityMapper('channel'))
  );

  return { users: deduplicatedUsers, channels: channelsWithParticipants };
};

export function useCombinedRecipients<
  K extends 'user' | 'channel' = 'user' | 'channel',
>(entities?: K[]): UseCombinedRecipients<K> {
  const kinds = entities ?? ['user', 'channel'];

  const { users, channels } = useCombinedRecipientsRoot();

  const includeUsers = kinds.includes('user');
  const includeChannels = kinds.includes('channel');

  const allRecipients = createMemo(() => {
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
