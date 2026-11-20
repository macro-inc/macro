import { describe, expect, test } from 'bun:test';
import type { RoutineMark } from './judge';
import { asWritten, type Inbox, type Persona, recentMessages, type RoutinesTruth, type StreamsTruth, variantOf, windowMessages } from './personas';
import { type Generation, type RoutineRow, workListOf } from './run';
import { boundedList, type EntryMark, type FoundStream, mailText, marksProblem, scoreList, scoreWorkList, trimAsRust, type WorkList } from './finding';
import { draftableNeeds, inInbox } from './month';
import { lines, withheldAcross } from './report';
import { type Attempt, failedScore, marginsOf, type RunFile, scoreRoutines, summary } from './score';
import { ANCHOR } from './clock';

const HOUR = 60 * 60_000;

/** A persona whose owner got one message every `every` hours before the anchor, newest first. */
function persona(count: number, every: number): Persona {
  const inbox: Inbox = {
    owner: { name: 'Ana Ruiz', email: 'ana@acme.example' },
    persona: 'test',
    timezone: 'UTC',
    messages: Array.from({ length: count }, (_, i) => ({
      from: { name: 'Bo', email: 'bo@acme.example' },
      to: ['ana@acme.example'],
      cc: [],
      date: new Date(ANCHOR - (i + 1) * every * HOUR).toISOString(),
      subject: `Message ${i + 1}`,
      labels: ['INBOX'],
      snippet: `Text ${i + 1}`,
    })),
  };
  return { name: 'test', seat: 1, heldout: false, dir: '', workspace: { scenario: 't', description: '', users: {} }, inbox };
}

describe('windowMessages', () => {
  test('keeps the last 30 days, newest first, with text only on the newest 100', () => {
    // One every 2 hours for 40 days: 360 in the window, the oldest exactly 30 days back.
    const { messages } = windowMessages(persona(480, 2), 'signup', ANCHOR);
    expect(messages).toHaveLength(360);
    expect(messages[0].subject).toBe('Message 1');
    expect(messages.every((m, i) => i === 0 || messages[i - 1].received_at >= m.received_at)).toBe(true);
    expect(messages.slice(0, 100).every((m) => typeof m.snippet === 'string')).toBe(true);
    expect(messages.slice(100).every((m) => m.snippet === null)).toBe(true);
    const oldest = Date.parse(messages[messages.length - 1].received_at);
    expect(ANCHOR - oldest).toBeLessThanOrEqual(30 * 24 * HOUR);
  });

  test('stops at 500 messages', () => {
    const { messages } = windowMessages(persona(700, 1), 'signup', ANCHOR);
    expect(messages).toHaveLength(500);
    expect(messages[499].subject).toBe('Message 500');
  });

  test('cuts the window at its exact start, whatever order the mail was written in', () => {
    const ana = persona(3, 1);
    const DAY = 24 * HOUR;
    ana.inbox.messages = [
      { ...ana.inbox.messages[0], subject: 'Just outside', date: new Date(ANCHOR - 30 * DAY - 1000).toISOString() },
      { ...ana.inbox.messages[1], subject: 'Newest', date: new Date(ANCHOR - HOUR).toISOString() },
      { ...ana.inbox.messages[2], subject: 'Just inside', date: new Date(ANCHOR - 30 * DAY + 1000).toISOString() },
    ];
    expect(windowMessages(ana, 'signup', ANCHOR).messages.map((m) => m.subject)).toEqual(['Newest', 'Just inside']);
  });

  test('reads the inbox alone, and cuts text by characters', () => {
    const ana = persona(2, 1);
    ana.inbox.messages[0] = { ...ana.inbox.messages[0], labels: ['SENT'] };
    ana.inbox.messages[1] = { ...ana.inbox.messages[1], snippet: '📦'.repeat(600) };
    const { messages } = windowMessages(ana, 'signup', ANCHOR);
    expect(messages.map((m) => m.subject)).toEqual(['Message 2']);
    expect([...messages[0].snippet!]).toHaveLength(500);
  });

  test('moves with the persona clock, as the newest-messages read does', () => {
    const later = ANCHOR + 3 * 24 * HOUR;
    const window = windowMessages(persona(150, 2), 'signup', later).messages;
    const recent = recentMessages(persona(150, 2), 'signup', later).messages;
    expect(window.slice(0, 100)).toEqual(recent);
  });
});

describe('recentMessages', () => {
  test('answers the newest 100 with their text, as before', () => {
    const { messages } = recentMessages(persona(120, 2), 'signup', ANCHOR);
    expect(messages).toHaveLength(100);
    expect(messages[99].snippet).toBe('Text 100');
  });
});

const row = (catalog_key: string | null, surfaces = ['tasks']): RoutineRow => ({
  id: crypto.randomUUID(),
  catalog_key,
  knob_values: {},
  routine: catalog_key ? null : { name: 'drafted' },
  reason: '',
  keep_probability: 0.7,
  surfaces,
  created_at: new Date(ANCHOR).toISOString(),
  session_id: 's',
});

const mark = (overrides: Partial<RoutineMark> = {}): RoutineMark => ({
  suggestion: '',
  meets: [],
  decoys: [],
  keep: 4,
  misfit: false,
  broken: false,
  bad_knob: false,
  wrong_surface: false,
  duplicate: false,
  unsafe: false,
  invented: false,
  why: '',
  ...overrides,
});

const generation = (routines: RoutineRow[]): Generation => ({
  persona: 'test',
  variant: 'signup',
  trigger: 'onboarding',
  now: ANCHOR,
  timezone: 'UTC',
  sessions: [],
  routines,
  cards: [],
  cost: { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0, models: {} },
});

const truth: RoutinesTruth = {
  needs: [
    { id: 'n1', what: 'invoices', evidence: [], catalog: [], drafted: 'a task per invoice', surfaces: ['tasks'] },
    { id: 'n2', what: 'triage', evidence: [], catalog: ['triage'], surfaces: ['tasks'] },
    { id: 'n3', what: 'leads', evidence: [], catalog: [], drafted: 'a lead log', surfaces: ['tasks'] },
  ],
  decoys: [{ id: 'd1', what: 'newsletters', why: 'read and ignored' }],
  fine: [],
  misfit: [],
};

const streams: StreamsTruth = {
  streams: ['work', 'work', 'noise'].map((kind, i) => ({
    id: `s${i + 1}`,
    kind: kind as 'work' | 'noise',
    name: `stream ${i + 1}`,
    senders: [],
    count: 10,
    cadence: 'weekly',
    what: '',
    action: '',
    labels: [],
    examples: [],
  })),
};

describe('scoreRoutines', () => {
  test('counts good drafts and good catalog picks apart', () => {
    const score = scoreRoutines(
      generation([row(null), row('triage'), row(null), row(null)]),
      [mark({ meets: ['n1'], streams: ['s1'] }), mark(), mark({ meets: ['n3'], decoys: ['d1'], streams: ['s3'] }), mark({ meets: [] })],
      truth,
      streams,
    );
    // The third meets a need but is a decoy; the fourth meets none.
    expect(score).toMatchObject({ drafts: 3, goodDrafts: 1, goodPicks: 1, aimed: 1, workStreams: 2 });
  });

  test('leaves streams out without a streams key', () => {
    const score = scoreRoutines(generation([row(null)]), [mark({ meets: ['n1'] })], truth);
    expect(score.goodDrafts).toBe(1);
    expect(score.aimed).toBeUndefined();
    expect(score.workStreams).toBeUndefined();
  });

  test('summarizes how many attempts reach five good drafts', () => {
    const five = scoreRoutines(
      generation(Array.from({ length: 5 }, () => row(null))),
      Array.from({ length: 5 }, () => mark({ meets: ['n1'] })),
      truth,
    );
    const one = scoreRoutines(generation([row(null)]), [mark({ meets: ['n1'] })], truth);
    const attempt = (score: typeof five): Attempt => ({
      section: 'routines',
      label: 't',
      persona: 'test',
      heldout: false,
      rep: 1,
      generation: { ...generation([]), status: 'ready' },
      judgeUsd: 0,
      score,
    });
    expect(summary([attempt(five), attempt(one)])).toMatchObject({ goodDrafts: 3, fiveGoodDrafts: 1 });
  });
});

describe('mailText', () => {
  test('reads each message as the finding call does', () => {
    const ana = persona(120, 1);
    ana.inbox.messages[0] = { ...ana.inbox.messages[0], subject: 'Order <1042>', labels: ['INBOX', 'Orders'], snippet: '  Please\nconfirm  ' };
    const lines = mailText(ana, ANCHOR).split('\n');
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d · Bo ‹bo@acme\.example› · Order ‹1042› · Orders$/);
    expect(lines[1]).toBe('    Please confirm');
    // The 101st message is read by its line alone.
    expect(lines.filter((line) => !line.startsWith('    '))).toHaveLength(120);
    expect(lines.filter((line) => line.startsWith('    '))).toHaveLength(100);
  });
});

describe('workListOf', () => {
  const list = { person: 'Runs a bakery', streams: [{ name: 'Supplier orders', senders: [], count: 9, cadence: '', what: '', action: '', handled_by: '', labels: [], keeps: '', examples: [] }] };
  const briefOf = (value: unknown) =>
    `Draft routines.\n<untrusted>\nmail\n</untrusted>\n\nThe streams of work a step found in the user's last 30 days of mail, those they would most regret missing first:\n<untrusted>\n${JSON.stringify(value)}\n</untrusted>`;
  const prompt = (value: unknown, created_at = '2026-11-20 10:00:00+00', direction = 'to_runtime') => ({
    direction,
    created_at,
    content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: briefOf(value) }] } },
  });

  test('reads the list a drafting session was briefed with', () => {
    expect(workListOf([{ direction: 'to_server', content: { type: 'event', event: 'acp_ready' } }, prompt(list)])).toEqual(list);
  });

  test('reads the earliest brief, whatever order the rows came in', () => {
    const retried = { ...list, person: 'Retried' };
    expect(workListOf([prompt(retried, '2026-11-20 10:05:00+00'), prompt(list, '2026-11-20 10:00:00+00')])).toEqual(list);
    // As `capture` writes the time: a thousandth of a second later sorts later.
    expect(workListOf([prompt(retried, '2026-11-20T10:00:00.001000Z'), prompt(list, '2026-11-20T10:00:00.000000Z')])).toEqual(list);
  });

  test('puts together the shares each drafting session read, a retried share once', () => {
    const stream = (name: string) => ({ ...list.streams[0], name });
    const share = (...names: string[]) => ({ person: 'Runs a bakery', streams: names.map(stream) });
    const inSession = (session: string, value: unknown, at: string) => ({ ...prompt(value, at), session });
    expect(
      workListOf([
        inSession('b', share('Invoices'), '2026-11-20 10:00:02+00'),
        inSession('a', share('Orders', 'Quotes'), '2026-11-20 10:00:01+00'),
        inSession('c', share('Invoices'), '2026-11-20 10:04:00+00'),
      ]),
    ).toEqual(share('Orders', 'Quotes', 'Invoices'));
  });

  test('reads only what the harness sent a runtime, in the shape of a list', () => {
    expect(workListOf([prompt(list, '2026-11-20 10:00:00+00', 'to_server')])).toBeUndefined();
    expect(workListOf([prompt({})])).toBeUndefined();
    expect(workListOf([prompt({ person: 'x', streams: [{ name: 'y' }] })])).toBeUndefined();
  });

  test('finds none where no session read a list', () => {
    expect(workListOf([{ direction: 'to_runtime', content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'Draft routines.\n<untrusted>\nmail\n</untrusted>' }] } } }])).toBeUndefined();
  });
});

const found = (name: string, count = 4): FoundStream => ({ name, senders: [{ name: 'Bo', email: 'bo@acme.example' }], count, cadence: 'weekly', what: '', action: '', handled_by: '', labels: [], keeps: '', examples: [] });
const listOf = (...names: string[]): WorkList => ({ person: 'Ana', streams: names.map((name) => found(name)) });
const entry = (n: number, stream: string, also: string[] = []): EntryMark => ({ n, stream, also, why: '' });
const keyed = (): Persona => ({ ...persona(1, 1), streamsTruth: streams });

describe('scoreList', () => {
  test('counts what an entry covers in full, even when it mostly covers noise', () => {
    const score = scoreList(keyed(), listOf('a', 'b'), [entry(1, 's3', ['s2']), entry(2, '')]);
    expect(score).toMatchObject({ work: 2, found: 1, unreal: 1, duplicates: 0, missed: ['s1'] });
  });

  test('counts a work stream listed twice once, and the second entry a duplicate', () => {
    const score = scoreList(keyed(), listOf('a', 'b'), [entry(1, 's1'), entry(2, 's1', ['s1'])]);
    expect(score).toMatchObject({ found: 1, unreal: 0, duplicates: 1 });
  });
});

describe('marksProblem', () => {
  const key = streams.streams;
  const list = listOf('a', 'b');
  test('takes marks that fit the list and the key', () => {
    expect(marksProblem(list, key, [entry(1, 's1'), entry(2, '', ['s2'])])).toBeUndefined();
  });
  test('refuses an entry unmarked, marked twice, off the list, or naming a stream the key lacks', () => {
    expect(marksProblem(list, key, [entry(1, 's1')])).toContain('unmarked');
    expect(marksProblem(list, key, [entry(1, 's1'), entry(1, 's2'), entry(2, '')])).toContain('twice');
    expect(marksProblem(list, key, [entry(1, 's1'), entry(3, '')])).toContain('not on the list');
    expect(marksProblem(list, key, [entry(1, 's9'), entry(2, '')])).toContain('s9');
    expect(marksProblem(list, key, [entry(1, 's1', ['s9']), entry(2, '')])).toContain('s9');
  });
});

describe('boundedList', () => {
  test('passes on what the service does: named streams, the first 20, cut texts', () => {
    const list = listOf('  ', ...Array.from({ length: 25 }, (_, i) => `Stream ${i}`));
    list.streams[1].what = '<b>'.repeat(300);
    const bounded = boundedList(list);
    expect(bounded.streams).toHaveLength(20);
    expect(bounded.streams[0].name).toBe('Stream 0');
    expect(bounded.streams[0].what).toHaveLength(400);
    expect(bounded.streams[0].what).not.toContain('<');
  });
  test('refuses a count the service would', () => {
    expect(() => boundedList({ person: 'Ana', streams: [found('a', 2.5)] })).toThrow('u32');
    expect(() => boundedList({ person: 'Ana', streams: [found('a', -1)] })).toThrow('u32');
  });
});

describe('asWritten', () => {
  test('reads every seat and copy of an address as written', () => {
    const ana = persona(1, 1);
    expect(asWritten(ana, 'bo@acme-s2-signup.example, cy@acme-signup.example, di@acme-s3.example, ed@acmex.example')).toBe(
      'bo@acme.example, cy@acme.example, di@acme.example, ed@acmex.example',
    );
  });
  test('leaves a longer domain alone, and reads one at the end of a sentence', () => {
    const ana = persona(1, 1);
    expect(asWritten(ana, 'user@acme-s2-signup.example.test, fy@acme-s2.example-mail.test; write to bo@acme-s2.example.')).toBe(
      'user@acme-s2-signup.example.test, fy@acme-s2.example-mail.test; write to bo@acme.example.',
    );
  });
  test('is what a seat\'s copy moved, and a longer domain stays as written both ways', () => {
    const ana = persona(1, 1);
    ana.inbox.messages[0] = { ...ana.inbox.messages[0], from: { name: 'Cy', email: 'cy@acme.example.test' }, to: ['ana@acme.example', 'di@acme.examples.test'] };
    const copy = variantOf({ ...ana, seat: 2 }, 'signup');
    expect(copy.inbox.owner.email).toBe('ana@acme-s2-signup.example');
    expect(copy.inbox.messages[0].from.email).toBe('cy@acme.example.test');
    expect(copy.inbox.messages[0].to).toEqual(['ana@acme-s2-signup.example', 'di@acme.examples.test']);
    expect(asWritten(ana, JSON.stringify(copy.inbox))).toBe(JSON.stringify(ana.inbox));
  });
});

describe('trimAsRust', () => {
  test('takes off what Rust\'s trim does, no more', () => {
    expect(trimAsRust('\u0085 a \u3000')).toBe('a');
    expect(trimAsRust('\uFEFF')).toBe('\uFEFF');
    expect(boundedList(listOf('\u0085', 'a')).streams.map((stream) => stream.name)).toEqual(['a']);
  });
  test('says when a sender\'s name is blank, as the service does', () => {
    const ana = persona(1, 1);
    ana.inbox.messages[0] = { ...ana.inbox.messages[0], from: { name: '\u0085', email: 'bo@acme.example' } };
    expect(mailText(ana, ANCHOR)).toMatch(/^\S+ \S+ \u00B7 bo@acme\.example \u00B7 /);
  });
});

describe('compare margins', () => {
  test('take three finite margins of 0 or more', () => {
    expect(marginsOf('10.9,0.48,0')).toEqual({ score: 10.9, found: 0.48, bad: 0 });
    for (const bad of ['1,2', '1,,2', '1,2,Infinity', '1,2,-1', '1,2,x']) expect(() => marginsOf(bad)).toThrow('--margins takes');
  });
});

describe('the finding score of a run', () => {
  const attempt = (over: Partial<Attempt>): Attempt => ({
    section: 'routines',
    label: 't',
    persona: 'test',
    heldout: false,
    rep: 1,
    generation: { ...generation([]), status: 'ready' },
    judgeUsd: 0,
    score: failedScore(3),
    ...over,
  });

  test('counts a failed build that read no list as finding nothing', () => {
    const read = scoreWorkList(keyed(), listOf('a', 'b'), [entry(1, 's1'), entry(2, 's2')]);
    const failed = scoreWorkList(keyed(), undefined, []);
    expect(failed).toMatchObject({ found: 0, work: 2, unread: true });
    const s = summary([attempt({ finding: read }), attempt({ generation: { ...generation([]), status: 'generating', buildFailed: true }, finding: failed })]);
    expect(s.finding).toMatchObject({ lists: 2, read: 1, found: 0.5 });
  });

  test('says so when no list could be judged', () => {
    const run: RunFile = { section: 'routines', label: 't', set: 'm', commit: 'c', attempts: [attempt({ findingError: 'judge' }), attempt({ findingError: 'judge' })] } as RunFile;
    expect(summary(run.attempts).finding).toMatchObject({ lists: 0, errors: 2 });
    expect(lines([run]).join('\n')).toContain('no work list could be judged (2 failed)');
  });

  test('shows a held-out aggregate only over two people or more, and no held-out error', () => {
    const heldout = (persona: string, over: Partial<Attempt> = {}) => attempt({ persona, heldout: true, ...over });
    const one: RunFile = { section: 'routines', label: 't', set: 'h', commit: 'c', attempts: [heldout('p1'), heldout('p1', { rep: 2 }), heldout('p2', { benchError: 'generation: no generation for p2@p2.example' })] } as RunFile;
    const shown = lines([one]).join('\n');
    expect(shown).toContain('1 held-out people scored, fewer than 2');
    expect(shown).not.toContain('0.0');
    expect(shown).not.toContain('p2');
    const two: RunFile = { ...one, attempts: [heldout('p1'), heldout('p2'), heldout('p3', { benchError: 'generation: no generation for p3@p3.example' })] };
    const both = lines([two]).join('\n');
    expect(both).toContain('| 0.0 (');
    expect(both).toContain('- a held-out generation #1: bench error');
    expect(both).not.toContain('p3');
  });

  test('sets two held-out runs side by side only over two people scored in both', () => {
    const heldout = (persona: string, over: Partial<Attempt> = {}) => attempt({ persona, heldout: true, ...over });
    const a = [heldout('p1'), heldout('p2')];
    const b = [heldout('p2'), heldout('p3')];
    expect(withheldAcross([a, b])).toContain('1 held-out people scored in every run, fewer than 2');
    expect(withheldAcross([a, [heldout('p1'), heldout('p2', { benchError: 'judge' })]])).toContain('1 held-out people scored');
    expect(withheldAcross([a, [heldout('p2'), heldout('p1')]])).toBeUndefined();
    expect(withheldAcross([[attempt({})], [attempt({ persona: 'other' })]])).toBeUndefined();
  });

  test('shows a held-out list score only over two people\'s lists', () => {
    const heldout = (persona: string, over: Partial<Attempt> = {}) => attempt({ persona, heldout: true, ...over });
    const list = scoreWorkList(keyed(), listOf('a', 'b'), [entry(1, 's1'), entry(2, 's2')]);
    const run: RunFile = { section: 'routines', label: 't', set: 'h', commit: 'c', attempts: [heldout('p1', { finding: list }), heldout('p2', { findingError: 'judge' })] } as RunFile;
    const shown = lines([run]).join('\n');
    expect(shown).toContain("1 held-out people's work lists judged, fewer than 2: not shown");
    expect(shown).not.toContain('named 100%');
    const two = lines([{ ...run, attempts: [heldout('p1', { finding: list }), heldout('p2', { finding: list })] }]).join('\n');
    expect(two).toContain('named 100%');
  });
});

describe('writing a month', () => {
  test('puts every message in the inbox', () => {
    expect(inInbox(['Orders'])).toEqual(['INBOX', 'Orders']);
    expect(inInbox(['INBOX', 'Orders'])).toEqual(['INBOX', 'Orders']);
  });

  test('counts each need a drafted routine meets once, and none whose routine is blank', () => {
    expect(draftableNeeds([{ id: 'r1', drafted: 'a task per invoice' }, { id: 'r1', drafted: 'again' }, { id: 'r2', drafted: '  ' }, { id: 'r3' }, { id: 'r4', drafted: 'a lead log' }])).toBe(2);
  });
});
