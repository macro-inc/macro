import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FromPeer, FromRemote } from '../../../crates/sync_protocol/bebop/generated/schema';

const fixtures = [
  ['peer-update', FromPeer.fromPeerUpdate({ updates: [new Uint8Array([0, 1, 255])], id: 'op' })],
  ['peer-comment-update', FromPeer.fromPeerCommentUpdate({ updates: [new Uint8Array([0, 1, 255])], id: 'op' })],
  ['peer-awareness', FromPeer.fromPeerAwareness({ awareness: new Uint8Array([3, 4]) })],
  ['peer-since', FromPeer.fromPeerRequestSince({ vv: new Uint8Array([5, 6]) })],
  ['peer-snapshot', FromPeer.fromPeerRequestSnapshot({})],
  ['peer-register', FromPeer.fromPeerRegisterId({ peerid: 0x0102030405060708n })],
  ['remote-initial', FromRemote.fromRemoteInitialSync({ snapshot: new Uint8Array([1, 2]), awareness: new Uint8Array([3, 4]) })],
  ['remote-update', FromRemote.fromRemoteUpdate({ update: new Uint8Array([0, 1, 255]) })],
  ['remote-awareness', FromRemote.fromRemoteAwareness({ awareness: new Uint8Array([3, 4]) })],
  ['remote-snapshot', FromRemote.fromRemoteSnapshot({ snapshot: new Uint8Array([1, 2]) })],
  ['remote-ack', FromRemote.fromRemoteUpdateAck({ id: 'op' })],
  ['remote-since', FromRemote.fromRemoteUpdateSince({ update: new Uint8Array([0, 1, 255]), vv: new Uint8Array([5, 6]) })],
] as const;

for (const [name, message] of fixtures) {
  test(`TypeScript codec matches ${name}`, () => {
    const path = join('tests/transcripts/codec', `${name}.bin`);
    if (process.env.SYNC_WRITE_CODEC_FIXTURES === '1') writeFileSync(path, message.encode());
    expect(Buffer.from(message.encode())).toEqual(readFileSync(path));
  });
}
