import { useChannelDirectory } from '@core/context/channels';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import { useIsConnectedSecondaryInbox } from '@core/user/inboxOnly';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import {
  isMessageDestinationChannel,
  toChannelListItem,
} from '@queries/channel/directory-core';
import { createMemo } from 'solid-js';
import { useTeammateIds } from '../team/roster';
import { createContactRecipientSource } from './recipient-window';
import { useContactDirectoryScope } from './use-directory';

export function useContactRecipientSource(
  input: RecipientSourceInput
): RecipientSource<'user'> {
  return createContactRecipientSource(
    useContactDirectoryScope(),
    input,
    useIsConnectedSecondaryInbox(),
    undefined,
    useTeammateIds(input.enabled)
  );
}

/** Channels remain their existing scoped source; personal contacts never form a catalog. */
export function useCombinedRecipientSource(
  input: RecipientSourceInput
): RecipientSource<'user' | 'channel'> {
  const people = useContactRecipientSource(input);
  const { channels } = useChannelDirectory();
  const groups = createMemo(() =>
    input.enabled()
      ? channels()
          .filter(isMessageDestinationChannel)
          .map((channel) =>
            recipientEntityMapper('channel')(toChannelListItem(channel))
          )
      : []
  );
  return {
    ...people,
    items: createMemo(() => [...people.items(), ...groups()]),
  };
}
