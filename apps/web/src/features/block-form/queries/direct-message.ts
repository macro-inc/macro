import { invalidateListChannels } from '@queries/channel/channels';
import { storageServiceClient } from '@service-storage/client';
import { ResultAsync } from 'neverthrow';
import type { FormWriteFailure } from '../context/form-context';

/** The 1:1 conversation with `recipientId`, made if new; answers its channel id. */
export function directMessageWith(
  recipientId: string
): ResultAsync<string, FormWriteFailure> {
  return new ResultAsync(
    storageServiceClient.getOrCreateDirectMessage({ recipient_id: recipientId })
  )
    .map(({ channel_id }) => {
      void invalidateListChannels();
      return channel_id;
    })
    .mapErr(([error]) => ({
      message: error?.message ?? 'The conversation could not be opened.',
    }));
}
