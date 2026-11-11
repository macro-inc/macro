/**
 * AI editors draw their Loro peer id at random from a reserved 2^40-wide block
 * (see `@macro-inc/collaboration/collab/ai-peer`). The sync service records the
 * identity each peer edits as, so a peer id must never be reused by another
 * edit session: a reuse would re-attribute every earlier edit made under it.
 *
 * A human's peer id is random across all 2^64 values, so the chance one lands
 * in this block is 2^-24.
 */

import { AI_PEER_BASE } from '@macro-inc/collaboration/collab/ai-peer';

export {
  AI_PEER_BASE,
  AI_PEER_COUNT,
  isAiPeer,
} from '@macro-inc/collaboration/collab/ai-peer';

/** A fresh AI peer id. Uniform over the 2^40 block, so two editors (live or
 *  across isolates) sharing one is vanishingly unlikely. */
export const nextAiPeerId = (): bigint => {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  const offset = (BigInt(high & 0xff) << 32n) | BigInt(low);
  return AI_PEER_BASE + offset;
};
