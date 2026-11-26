import { getOrCreateDirectMessageChannel } from '@queries/channel/get-or-create-dm';
import type { ResultAsync } from 'neverthrow';
import type { FormWriteFailure } from '../context/form-context';

/** The 1:1 conversation with `recipientId`, made if new; answers its channel id. */
export function directMessageWith(
  recipientId: string
): ResultAsync<string, FormWriteFailure> {
  return getOrCreateDirectMessageChannel(recipientId).mapErr(([error]) => ({
    message: error?.message ?? 'The conversation could not be opened.',
  }));
}
