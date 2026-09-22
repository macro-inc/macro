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
  const isChannel = () => parent().type === 'channel';
  const channelParticipants = useChannelParticipants(() =>
    isChannel() ? parent().id : ''
  );
  const contacts = useContacts(() => !isChannel());

  return createMemo(() =>
    isChannel() ? channelParticipants.users() : contacts()
  );
}
