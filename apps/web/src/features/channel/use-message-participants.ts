import type { IUser } from '@core/user/types';
import { useContacts } from '@queries/contacts/contacts';
import type { MessageParent } from '@service-storage/messages';
import { type Accessor, createMemo } from 'solid-js';
import { useChannelParticipants } from './use-channel-participants';

/**
 * The people a composer on `parent` offers in the `@`-mention typeahead: a
 * channel's participants, or, on a document, the workspace contacts the
 * legacy comment input suggested. Mirrors `useMessageBotMentionUsers` so that
 * every composer on a parent — root, reply, and edit — suggests the same
 * people without each one resolving them again.
 */
export function useMessageParticipants(
  parent: Accessor<MessageParent>
): Accessor<IUser[]> {
  const channelParticipants = useChannelParticipants(() =>
    parent().type === 'channel' ? parent().id : ''
  );
  const contacts = useContacts();

  return createMemo(() =>
    parent().type === 'channel' ? channelParticipants.users() : contacts()
  );
}
