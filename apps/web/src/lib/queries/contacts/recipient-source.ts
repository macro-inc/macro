import { useChannelsContext } from '@core/context/channels';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import { useIsConnectedSecondaryInbox } from '@core/user/inboxOnly';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import { createMemo } from 'solid-js';
import { createContactRecipientSource } from './recipient-window';
import { useContactDirectoryScope } from './use-directory';

export function useContactRecipientSource(
  input: RecipientSourceInput
): RecipientSource<'user'> {
  return createContactRecipientSource(
    useContactDirectoryScope(),
    input,
    useIsConnectedSecondaryInbox()
  );
}

/** Channels remain their existing scoped source; personal contacts never form a catalog. */
export function useCombinedRecipientSource(
  input: RecipientSourceInput
): RecipientSource<'user' | 'channel'> {
  const people = useContactRecipientSource(input);
  const channels = useChannelsContext();
  const groups = createMemo(() =>
    input.enabled()
      ? channels
          .channels()
          .filter((channel) => channel.participants.length > 2)
          .map(recipientEntityMapper('channel'))
      : []
  );
  return {
    ...people,
    items: createMemo(() => [...people.items(), ...groups()]),
  };
}
