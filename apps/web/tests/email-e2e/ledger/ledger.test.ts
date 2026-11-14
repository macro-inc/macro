import { describe, expect, it } from 'vitest';
import { graphqlOperations, socketMessages } from '../harness/front';
import { restMatcher } from './ledger';
import { segments } from './lines';
import { markRan } from './record';

/** A websocket frame as a browser sends it: masked. */
function frame(payload: Buffer, opcode: number, final = true): Buffer {
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const head =
    payload.length < 126
      ? Buffer.from([0, 0x80 | payload.length])
      : Buffer.from([0, 0x80 | 126, payload.length >> 8, payload.length & 255]);
  head[0] = (final ? 0x80 : 0) | opcode;
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

describe('socketMessages', () => {
  it('reads a message split over chunks, fragments and a ping', () => {
    const seen: string[] = [];
    const feed = socketMessages((text) => seen.push(text));
    const long = 'x'.repeat(300);
    const bytes = Buffer.concat([
      frame(Buffer.from('one'), 1),
      frame(Buffer.from('tw'), 1, false),
      frame(Buffer.alloc(0), 9),
      frame(Buffer.from('o'), 0),
      frame(Buffer.from([1, 2, 3]), 2),
      frame(Buffer.from(long), 1),
    ]);
    for (let at = 0; at < bytes.length; at += 7) {
      feed(bytes.subarray(at, at + 7));
    }
    expect(seen).toEqual(['one', 'two', long]);
  });
});

describe('graphqlOperations', () => {
  it('names the operations of a request, a batch and a socket message', () => {
    expect(
      graphqlOperations(
        '{"operationName":"SaveEmailDraft","query":"mutation X { a }"}'
      )
    ).toEqual(['SaveEmailDraft']);
    expect(
      graphqlOperations(
        '[{"query":"query One { a }"},{"query":" mutation Two($a: Int) { a }"}]'
      )
    ).toEqual(['One', 'Two']);
    expect(
      graphqlOperations(
        '{"id":"1","type":"subscribe","payload":{"query":"subscription Live { a }"}}'
      )
    ).toEqual(['Live']);
    expect(graphqlOperations('{"query":"{ a }"}')).toEqual([]);
    expect(graphqlOperations('not json "query"')).toEqual([]);
  });
});

describe('restMatcher', () => {
  const match = restMatcher([
    { id: 'GET /email/email/threads/{}', kind: 'rest', scope: 'email' },
    { id: 'GET /email/email/threads/scheduled', kind: 'rest', scope: 'email' },
    {
      id: 'POST /email/email/threads/{}/archive',
      kind: 'rest',
      scope: 'email',
    },
    { id: 'Threads', kind: 'query', scope: 'email' },
  ]);

  it('prefers the literal route and keeps to whole segments', () => {
    expect(match('GET', '/email/email/threads/scheduled')).toBe(
      'GET /email/email/threads/scheduled'
    );
    expect(match('GET', '/email/email/threads/abc')).toBe(
      'GET /email/email/threads/{}'
    );
    expect(match('POST', '/email/email/threads/abc/archive')).toBe(
      'POST /email/email/threads/{}/archive'
    );
    expect(match('GET', '/email/email/threads/abc/archive')).toBeUndefined();
    expect(match('DELETE', '/email/email/threads/abc')).toBeUndefined();
  });
});

describe('segments', () => {
  it('decodes columns, sources and lines across generated lines', () => {
    // Line 0: column 0 -> source 0 line 0; column 4 -> source 0 line 2.
    // Line 1: a segment without a source, then column 2 -> source 1 line 1.
    expect(segments('AAAA,IAEA;A,ECDA')).toEqual([
      { line: 0, column: 0, source: 0, sourceLine: 0 },
      { line: 0, column: 4, source: 0, sourceLine: 2 },
      { line: 1, column: 2, source: 1, sourceLine: 1 },
    ]);
  });
});

describe('markRan', () => {
  it('lets an inner range decide and keeps what ran before', () => {
    const ran = new Uint8Array(10);
    markRan(ran, [
      {
        functionName: 'outer',
        isBlockCoverage: true,
        ranges: [
          { startOffset: 0, endOffset: 10, count: 1 },
          { startOffset: 4, endOffset: 8, count: 0 },
        ],
      },
    ]);
    expect([...ran]).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 1, 1]);
    markRan(ran, [
      {
        functionName: 'outer',
        isBlockCoverage: true,
        ranges: [
          { startOffset: 0, endOffset: 10, count: 0 },
          { startOffset: 4, endOffset: 6, count: 2 },
        ],
      },
    ]);
    expect([...ran]).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 1, 1]);
  });
});
