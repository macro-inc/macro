import { describe, expect, it } from 'vitest';
import {
  graphqlFailed,
  graphqlOperations,
  socketMessages,
} from '../harness/front';
import { type Enforced, fullStackOnly, violations } from './enforce';
import {
  functionRows,
  functionTotals,
  goneSources,
  networkDrift,
  restMatcher,
} from './ledger';
import {
  parseFullStackOnly,
  parseFunctions,
  parseProofs,
  parseWaivers,
} from './manifest/functions';

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

describe('graphqlFailed', () => {
  it('finds the errors of an answer and of one answer in a batch', () => {
    expect(graphqlFailed('{"data":{"a":1}}')).toBe(false);
    expect(graphqlFailed('{"data":{"errors":"a field"},"errors":[]}')).toBe(
      false
    );
    expect(graphqlFailed('{"data":null,"errors":[{"message":"no"}]}')).toBe(
      true
    );
    expect(graphqlFailed('[{"data":{}},{"errors":[{"message":"no"}]}]')).toBe(
      true
    );
    expect(graphqlFailed('"errors" but not json')).toBe(false);
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
    expect(() =>
      parseFunctions(TABLE.replace('yes\tno\tno', 'no\tno\tno'))
    ).toThrow('F-003');
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

  it('counts a covered function as proved only with a proof', () => {
    const both = [
      test('gmail', 'g', 'F-002', { performed: true, seen: true }),
      test('outlook', 'o', 'F-002', { performed: true, seen: true }),
    ];
    const proofs = parseProofs('id\tbreak\nF-002\tthe sort ignores its key\n');
    expect(functionTotals(functionRows(functions, both, rows)).proved).toBe(0);
    const proved = functionRows(functions, both, rows, proofs);
    expect(functionTotals(proved).proved).toBe(1);
    expect(proved[1].proof).toBe('the sort ignores its key');
    expect(
      parseProofs('id\tbreak\nAL-120\tRetry asks for nothing\n').get('AL-120')
    ).toBe('Retry asks for nothing');
    expect(() => parseProofs('id\tbreak\nF-2\tx\n')).toThrow('F-2');
    expect(() => parseProofs('id\tbreak\nF-002\tx\nF-002\ty\n')).toThrow(
      'twice'
    );
    // A proof of a function one provider still lacks proves nothing yet.
    const half = functionRows(functions, both.slice(0, 1), rows, proofs);
    expect(half[1].status).toBe('partial');
    expect(functionTotals(half).proved).toBe(0);
  });

  it('defers a function whose every way needs more, and leaves the backend its own', () => {
    const [star, sort, refresh] = functionRows(functions, [], rows);
    expect(star.status).toBe('open');
    expect(sort.status).toBe('deferred');
    expect(sort.reason).toBe('a clock');
    expect(refresh.status).toBe('backend');
  });
});

describe('parseWaivers', () => {
  it('reads a function on a provider and a row', () => {
    expect(
      parseWaivers(
        'id\ton\tkind\treason\nF-001\toutlook\tbug\tfails\nAL-001\t-\tbacklog\tlater\n'
      )
    ).toEqual([
      { id: 'F-001', on: 'outlook', kind: 'bug', reason: 'fails' },
      { id: 'AL-001', on: '-', kind: 'backlog', reason: 'later' },
    ]);
  });

  it('refuses a waiver without a reason, of no kind, or given twice', () => {
    const head = 'id\ton\tkind\treason\n';
    expect(() => parseWaivers(`${head}AL-001\t-\tbacklog\t \n`)).toThrow(
      'AL-001'
    );
    expect(() => parseWaivers(`${head}AL-001\t-\tlazy\twhy\n`)).toThrow(
      'AL-001'
    );
    expect(() => parseWaivers(`${head}AL-001\tgmail\tbug\twhy\n`)).toThrow(
      'AL-001'
    );
    expect(() =>
      parseWaivers(`${head}AL-001\t-\tbug\twhy\nAL-001\t-\tbug\twhy\n`)
    ).toThrow('twice');
  });
});

describe('parseFullStackOnly', () => {
  it('reads functions on a provider and rows', () => {
    expect(parseFullStackOnly('id\ton\nAL-001\t-\nF-001\tgmail\n')).toEqual([
      'AL-001',
      'F-001 gmail',
    ]);
    expect(() => parseFullStackOnly('id\ton\nF-001\tboth\n')).toThrow('F-001');
  });
});

describe('violations', () => {
  const functions = parseFunctions(TABLE);
  const input = (over: Partial<Enforced>): Enforced => ({
    functions,
    rows: ['AL-001', 'AL-002', 'STL-001'],
    proofs: new Map([
      ['F-001', 'a break'],
      ['F-002', 'a break'],
      ['AL-001', 'a break of one way in'],
      ['STL-001', 'a break of what shows it'],
    ]),
    waivers: [{ id: 'AL-002', on: '-', kind: 'backlog', reason: 'later' }],
    fullStackOnly: ['F-002 gmail', 'F-002 outlook', 'STL-001'],
    covered: {
      gating: new Set(['F-001 gmail', 'F-001 outlook', 'AL-001']),
      'full-stack': new Set(['F-002 gmail', 'F-002 outlook', 'STL-001']),
    },
    knownBugsPassing: [],
    ...over,
  });

  it('finds nothing when each stack covers its own and the rest is waived', () => {
    expect(violations(input({}))).toEqual([]);
    expect(
      violations(input({ covered: { gating: input({}).covered.gating } }))
    ).toEqual([]);
  });

  it('fails a function that lost its passing test on one provider', () => {
    expect(
      violations(
        input({ covered: { gating: new Set(['F-001 gmail', 'AL-001']) } })
      )
    ).toEqual([
      'F-001 outlook has no passing test on the per-test stack and no waiver',
    ]);
  });

  it('holds what only the tier covers to the tier', () => {
    expect(
      violations(
        input({
          covered: { 'full-stack': new Set(['F-002 gmail', 'STL-001']) },
        })
      )
    ).toEqual([
      'F-002 outlook has no passing test on the full-stack tier and no waiver',
    ]);
  });

  it('fails a row with neither a test nor a waiver', () => {
    expect(violations(input({ waivers: [] }))).toEqual([
      "AL-002 is not proved: proofs.tsv names no break that makes its test fail at the row's own assertion",
      'AL-002 has no passing test on the per-test stack and no waiver',
    ]);
  });

  it('fails a waiver that a passing test contradicts', () => {
    const covered = new Set([...(input({}).covered.gating ?? []), 'AL-002']);
    expect(violations(input({ covered: { gating: covered } }))).toEqual([
      'AL-002 is waived and a test on the per-test stack covers it: remove it from waivers.tsv',
    ]);
  });

  it('fails a known-bug test that passes', () => {
    expect(
      violations(input({ knownBugsPassing: ['a.spec.ts:3 sends'] }))
    ).toEqual([
      'a test kept for a known bug passes: remove its @known-bug tag and its waiver: a.spec.ts:3 sends',
    ]);
  });

  it('fails a covered function without a proof, and lists that name nothing', () => {
    expect(
      violations(
        input({
          proofs: new Map([
            ['F-001', 'a break'],
            ['AL-001', 'a break of one way in'],
            ['STL-001', 'a break of what shows it'],
            ['AL-008', 'a break of a row that is gone'],
          ]),
          waivers: [
            { id: 'AL-002', on: '-', kind: 'backlog', reason: 'later' },
            { id: 'AL-009', on: '-', kind: 'backlog', reason: 'later' },
          ],
        })
      )
    ).toEqual([
      'waivers.tsv: AL-009 is not a row, or not a function with a UI on that provider',
      'proofs.tsv: AL-008 is not a row of the manifest',
      'F-002 is not proved: proofs.tsv names no break that makes its tests fail',
    ]);
  });

  it('fails a row without a proof unless it is waived', () => {
    expect(
      violations(
        input({
          proofs: new Map([
            ['F-001', 'a break'],
            ['F-002', 'a break'],
            ['AL-001', 'a break of one way in'],
          ]),
        })
      )
    ).toEqual([
      "STL-001 is not proved: proofs.tsv names no break that makes its test fail at the row's own assertion",
    ]);
  });
});

describe('fullStackOnly', () => {
  it('lists what the tier covers and the per-test stack does not', () => {
    expect(
      fullStackOnly(
        {
          gating: new Set(['AL-001', 'F-001 gmail']),
          'full-stack': new Set(['AL-001', 'STL-001', 'F-002 gmail', 'AL-002']),
        },
        [{ id: 'AL-002', on: '-', kind: 'backlog', reason: 'later' }]
      )
    ).toBe('id\ton\nF-002\tgmail\nSTL-001\t-\n');
  });
});

describe('networkDrift', () => {
  const GRAPHQL = 'src/lib/service-clients/service-storage/graphql';
  const listed = [
    { id: 'SaveEmailDraft', kind: 'mutation', scope: 'email' },
    { id: 'Soup', kind: 'query', scope: 'shared' },
    { id: 'Calendars', kind: 'query', scope: 'shared' },
  ] as const;
  const defined = [
    {
      id: 'SaveEmailDraft',
      kind: 'mutation',
      file: `${GRAPHQL}/email-draft.graphql`,
    },
    { id: 'Soup', kind: 'query', file: `${GRAPHQL}/soup.graphql` },
    { id: 'Calendars', kind: 'query', file: `${GRAPHQL}/calendar.graphql` },
  ] as const;

  it('passes when another part of the app adds or removes an operation', () => {
    expect(
      networkDrift(
        'GraphQL operations',
        'GRAPHQL',
        [
          // Soup and Calendars are listed as shared: both gone.
          ...defined.filter((each) => each.id === 'SaveEmailDraft'),
          {
            id: 'NotificationInboxClears',
            kind: 'query',
            file: `${GRAPHQL}/notification-inbox.graphql`,
          },
          // Its name alone does not make it email's.
          {
            id: 'InviteByEmail',
            kind: 'mutation',
            file: `${GRAPHQL}/team.graphql`,
          },
        ],
        listed
      )
    ).toEqual([]);
    expect(
      networkDrift(
        'Email service calls',
        'REST',
        [{ id: 'GET /calendar/rooms', kind: 'rest', file: 'client.ts' }],
        []
      )
    ).toEqual([]);
  });

  it('fails on a new email operation and names the line to add', () => {
    expect(
      networkDrift(
        'GraphQL operations',
        'GRAPHQL',
        [
          ...defined,
          {
            id: 'SnoozeEmailThread',
            kind: 'mutation',
            file: `${GRAPHQL}/email-snooze.graphql`,
          },
        ],
        listed
      )
    ).toEqual([
      {
        check:
          "GraphQL operations: email's in the source, not in the network list",
        items: [
          `SnoozeEmailThread (${GRAPHQL}/email-snooze.graphql): add \`{ id: 'SnoozeEmailThread', kind: 'mutation', scope: 'email' },\` to GRAPHQL in tests/email-e2e/ledger/manifest/network.ts`,
        ],
      },
    ]);
    expect(
      networkDrift(
        'Email service calls',
        'REST',
        [
          {
            id: 'POST /email/email/threads/{}/pin',
            kind: 'rest',
            file: 'client.ts',
          },
        ],
        []
      )[0].items
    ).toEqual([
      "POST /email/email/threads/{}/pin (client.ts): add `{ id: 'POST /email/email/threads/{}/pin', kind: 'rest', scope: 'email' },` to REST in tests/email-e2e/ledger/manifest/network.ts",
    ]);
  });

  it('fails when an operation of email is gone from the source', () => {
    expect(
      networkDrift(
        'GraphQL operations',
        'GRAPHQL',
        defined.filter((each) => each.id !== 'SaveEmailDraft'),
        listed
      )
    ).toEqual([
      {
        check:
          "GraphQL operations: email's in the network list, gone from the source",
        items: [
          'SaveEmailDraft: no longer in the source: remove or rename its line in GRAPHQL in tests/email-e2e/ledger/manifest/network.ts',
        ],
      },
    ]);
    expect(
      networkDrift(
        'Email service calls',
        'REST',
        [],
        [
          { id: 'GET /email/email/threads/{}', kind: 'rest', scope: 'email' },
          { id: 'GET /calendar/calendars', kind: 'rest', scope: 'shared' },
        ]
      )[0].items
    ).toEqual([
      'GET /email/email/threads/{}: no longer in the source: remove or rename its line in REST in tests/email-e2e/ledger/manifest/network.ts',
    ]);
  });
});

describe('networkDrift on scopes', () => {
  const GRAPHQL = 'src/lib/service-clients/service-storage/graphql';

  // When this fails, a line can say an operation is email's while the
  // check does not hold it, or the reverse.
  it('fails when a line has the scope the source does not give it', () => {
    expect(
      networkDrift(
        'GraphQL operations',
        'GRAPHQL',
        [
          { id: 'Soup', kind: 'query', file: `${GRAPHQL}/soup.graphql` },
          {
            id: 'MailAccounts',
            kind: 'query',
            file: `${GRAPHQL}/soup.graphql`,
          },
        ],
        [
          { id: 'Soup', kind: 'query', scope: 'email' },
          { id: 'MailAccounts', kind: 'query', scope: 'shared' },
        ]
      )
    ).toEqual([
      {
        check: 'GraphQL operations: listed under the wrong scope',
        items: [
          `Soup (${GRAPHQL}/soup.graphql): is not email's own: give its line \`scope: 'shared'\` in GRAPHQL in tests/email-e2e/ledger/manifest/network.ts`,
          `MailAccounts (${GRAPHQL}/soup.graphql): is email's own: give its line \`scope: 'email'\` in GRAPHQL in tests/email-e2e/ledger/manifest/network.ts`,
        ],
      },
    ]);
  });
});

describe('goneSources', () => {
  const row = (id: string, source: string[]) => ({
    id,
    surface: 'SL-001',
    label: id,
    source,
  });
  const groups = [
    {
      name: 'list',
      surfaces: [],
      actions: [
        row('AL-001', ['src/features/email-view/EmailView.tsx']),
        row('AL-002', ['src/features/settings/Email.tsx']),
      ],
      states: [row('STL-001', ['src/components/app/Layout.tsx'])],
    },
  ] as unknown as Parameters<typeof goneSources>[0];

  // When this fails, a refactor of code shared with the rest of the app
  // fails the email job.
  it('only reports a shared file that is gone', () => {
    const drift = goneSources(
      groups,
      (file) => file !== 'src/components/app/Layout.tsx'
    );
    expect(drift).toHaveLength(1);
    expect(drift[0].reported).toBe(true);
    expect(drift[0].items).toEqual([
      'STL-001: src/components/app/Layout.tsx is gone: name the file that holds it now in `source` of STL-001 in tests/email-e2e/ledger/manifest/list.ts',
    ]);
  });

  // When this fails, a row can go on naming a file of email's that no
  // longer exists, or the message does not say which row to change.
  it("fails for a file of email's own, naming the row and its manifest", () => {
    const drift = goneSources(
      groups,
      (file) => file === 'src/components/app/Layout.tsx'
    );
    expect(drift).toHaveLength(1);
    expect(drift[0].reported).toBeUndefined();
    expect(drift[0].items).toEqual([
      'AL-001: src/features/email-view/EmailView.tsx is gone: name the file that holds it now in `source` of AL-001 in tests/email-e2e/ledger/manifest/list.ts',
      'AL-002: src/features/settings/Email.tsx is gone: name the file that holds it now in `source` of AL-002 in tests/email-e2e/ledger/manifest/list.ts, and in EMAIL_FILES_ELSEWHERE in tests/email-e2e/ledger/derive.ts',
    ]);
  });
});
