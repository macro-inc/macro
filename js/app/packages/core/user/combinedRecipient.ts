import type { PersonEmailContact } from './emailContacts';
import type { ChannelWithParticipants, ContactInfo, IUser } from './types';

// this type is extracted from the user's message info
export type ExtractedContactInfo = ContactInfo & {
  id: string;
  type: 'extracted';
};

export type CustomUserInput = {
  id: string;
  email: string;
  invalid: boolean;
};

type EntityMap = {
  user: IUser;
  channel: ChannelWithParticipants;
  contact: ExtractedContactInfo | PersonEmailContact;
  custom: CustomUserInput;
};

type Entity<T extends keyof EntityMap> = {
  kind: T;
  id: EntityMap[T]['id'];
  data: EntityMap[T];
};

type PickEntity<K extends keyof EntityMap> = {
  [P in K]: Entity<P>;
}[K];

export type CombinedRecipientKind = keyof EntityMap;

export type WithCustomUserInput<
  K extends CombinedRecipientKind = CombinedRecipientKind,
> = CombinedRecipientItem<K> | CombinedRecipientItem<'custom'>;

export type CombinedRecipientItem<K extends keyof EntityMap = keyof EntityMap> =
  PickEntity<K>;

type EntityMapper<K extends keyof EntityMap> = (
  data: EntityMap[K]
) => PickEntity<K>;

export function recipientEntityMapper<K extends keyof EntityMap>(
  kind: K
): EntityMapper<K> {
  return (data: EntityMap[K]) => ({ kind, data, id: data.id });
}
