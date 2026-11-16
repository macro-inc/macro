import { thrownResultErrorHasCode } from '@core/util/result';
import { entityMessagesClient } from '@service-storage/messages';
import { forgetUnqueuedSend, type UnqueuedSend } from './unqueued-sends';
import { whenOnline } from './writes';

export interface LeftBehindSendDeps {
  post?: typeof entityMessagesClient.post;
  online?: () => Promise<void>;
  forget?: typeof forgetUnqueuedSend;
}

/**
 * Posts over REST a send an earlier page noted for the device queue and never
 * saw stored, for a page where channels no longer go through the queue. The
 * message keeps its id, so a send the queue did deliver after all is answered
 * as already stored. A send that fails stays noted for the next start.
 */
export async function sendLeftBehindOverRest(
  send: UnqueuedSend,
  deps: LeftBehindSendDeps = {}
): Promise<void> {
  await (deps.online ?? whenOnline)();
  try {
    await (deps.post ?? entityMessagesClient.post)(
      { type: 'channel', id: send.channelId },
      { ...send.message, id: send.id, nonce: send.id }
    );
  } catch (error) {
    if (!thrownResultErrorHasCode(error, 'CONFLICT')) throw error;
  }
  (deps.forget ?? forgetUnqueuedSend)(send.senderId, send.id);
}
