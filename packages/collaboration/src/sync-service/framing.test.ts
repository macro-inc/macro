import { describe, expect, it } from 'vitest';
import { FromPeer, ToRouter } from './generated/schema';

// bebop's TS runtime encodes through one shared static buffer and returns a
// subarray of it, so nesting an encoded frame inside another frame ships
// garbage unless the inner bytes are copied first (gateway.ts `sendFrame`).
describe('router envelope framing', () => {
  it('keeps a nested FromPeer payload decodable', () => {
    const update = new Uint8Array(64).fill(7);
    const inner = FromPeer.fromPeerUpdate({ updates: [update], id: 'batch-1' });
    const payload = new Uint8Array(FromPeer.encode(inner));

    const envelope = ToRouter.decode(
      ToRouter.encode(
        ToRouter.fromRouterFrame({ docId: 'doc-1', payload })
      )
    );
    if (!envelope.isRouterFrame()) throw new Error('expected a RouterFrame');
    expect(new Uint8Array(envelope.value.payload)).toEqual(payload);

    const decoded = FromPeer.decode(envelope.value.payload);
    if (!decoded.isPeerUpdate()) throw new Error('expected a PeerUpdate');
    expect(decoded.value.id).toBe('batch-1');
    expect(new Uint8Array(decoded.value.updates[0])).toEqual(update);
  });
});
