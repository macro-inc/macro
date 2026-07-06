/**
 * AI editors draw their Loro peer id from a small reserved block whose decimal
 * form is 15 leading 9s followed by a 3-digit identity, i.e.
 * `999999999999999000 ... 999999999999999999`.
 *
 * A human's peer id is random across all 2^64 values, so the chance one lands in
 * this 1000-wide window is basically zero.
 */

/** How many distinct AI identities the block holds (the 3-digit suffix). */
export const AI_PEER_COUNT = 1000;

/** Start of the reserved block, `[BASE, BASE + AI_PEER_COUNT)`. */
export const AI_PEER_BASE = 999_999_999_999_999_000n;

/** Whether a peer id was minted by an AI editor (lives in the reserved block). */
export const isAiPeer = (peer: bigint): boolean =>
  peer >= AI_PEER_BASE && peer < AI_PEER_BASE + BigInt(AI_PEER_COUNT);

// the worker's lifecycle is naturally short-lived enough that this should be fine
let nextOffset = 0;

/** Hand out the next AI peer id, cycling through the block. Sequential, so
 *  consecutive editors never share an id; with concurrency far below
 *  AI_PEER_COUNT, two live editors can never collide. */
export const nextAiPeerId = (): bigint => {
  const id = AI_PEER_BASE + BigInt(nextOffset);
  nextOffset = (nextOffset + 1) % AI_PEER_COUNT;
  return id;
};
