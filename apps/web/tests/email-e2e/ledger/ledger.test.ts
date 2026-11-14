import { describe, expect, it } from 'vitest';
import { graphqlOperations, socketMessages } from '../harness/front';
import { functionRows, restMatcher } from './ledger';
import { parseFunctions } from './manifest/functions';

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

const TABLE = [
  'id\tarea\tfunction\tgmail\toutlook\tui\tresult_checked_at',
  'F-001\torganise\tStar a thread\tyes\tyes\tyes\tprovider',
  'F-002\tlist\tSort the list\tyes\tyes\tyes\tui',
  'F-003\tsync\tRefresh tokens\tyes\tno\tno\tprovider',
  '',
].join('\n');

describe('parseFunctions', () => {
  it('reads the table', () => {
    expect(parseFunctions(TABLE)[2]).toEqual({
      id: 'F-003',
      area: 'sync',
      name: 'Refresh tokens',
      providers: ['gmail'],
      ui: false,
      checkedAt: 'provider',
    });
  });

  it('refuses a row it cannot read', () => {
    expect(() => parseFunctions(TABLE.replace('yes\tui', 'maybe\tui'))).toThrow(
      'F-002'
    );
    expect(() => parseFunctions('id\tname\n')).toThrow('head');
  });
});

describe('functionRows', () => {
  const functions = parseFunctions(TABLE);
  const rows = [
    { id: 'A-1', kind: 'action', fn: ['F-001'], status: 'open' },
    { id: 'S-1', kind: 'state', fn: ['F-001'], status: 'open' },
    {
      id: 'A-2',
      kind: 'action',
      fn: ['F-002'],
      status: 'deferred',
      reason: 'a clock',
    },
  ] as const;
  const test = (
    provider: 'gmail' | 'outlook',
    title: string,
    id: string,
    pieces: { performed?: boolean; seen?: boolean; confirmed?: boolean }
  ) => ({
    provider,
    file: 'a.spec.ts',
    title,
    functions: [
      { id, performed: false, seen: false, confirmed: false, ...pieces },
    ],
  });

  it('needs the whole of a function in one test, on every provider', () => {
    const [star] = functionRows(
      functions,
      [
        test('gmail', 'whole', 'F-001', {
          performed: true,
          seen: true,
          confirmed: true,
        }),
        // Done in one test and checked in another: not covered.
        test('outlook', 'does', 'F-001', { performed: true, seen: true }),
        test('outlook', 'checks', 'F-001', { confirmed: true }),
      ],
      rows
    );
    expect(star.on.gmail.covered).toBe(true);
    expect(star.on.outlook.covered).toBe(false);
    expect(star.status).toBe('partial');
    expect(star.missing).toEqual(['outlook: no one test does all of it']);
    expect(star.variants).toEqual(['A-1']);
    expect(star.states).toEqual(['S-1']);
  });

  it('asks for no provider check where the result is only on screen', () => {
    const sort = functionRows(
      functions,
      [
        test('gmail', 'g', 'F-002', { performed: true, seen: true }),
        test('outlook', 'o', 'F-002', { performed: true, seen: true }),
      ],
      rows
    )[1];
    expect(sort.status).toBe('covered');
  });

  it('asks for no action where the user takes none', () => {
    const [arrive] = functionRows(
      functions,
      [
        test('gmail', 'g', 'F-001', { seen: true, confirmed: true }),
        test('outlook', 'o', 'F-001', { seen: true }),
      ],
      rows.filter((row) => row.kind === 'state')
    );
    expect(arrive.on.gmail.covered).toBe(true);
    expect(arrive.missing).toEqual([
      'outlook: result not checked at the provider',
    ]);
  });

  it('defers a function whose every way needs more, and leaves the backend its own', () => {
    const [star, sort, refresh] = functionRows(functions, [], rows);
    expect(star.status).toBe('open');
    expect(sort.status).toBe('deferred');
    expect(sort.reason).toBe('a clock');
    expect(refresh.status).toBe('backend');
  });
});
