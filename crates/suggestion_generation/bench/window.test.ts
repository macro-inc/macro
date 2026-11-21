import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoutineMark } from './judge';
import { asWritten, type Inbox, type Persona, recentMessages, type RoutinesTruth, type StreamsTruth, variantOf, windowMessages } from './personas';
import { type Generation, readWorkList, rereadList, type RoutineRow, workListOf } from './run';
import { boundedList, type EntryMark, type FoundStream, mailText, marksProblem, scoreList, scoreWorkList, trimAsRust, type WorkList } from './finding';
import { draftableNeeds, inInbox, pooled } from './month';
import { repeatsEarlier, rosterProblem } from './heldout';
import { lines, withheldAcross } from './report';
import { type Attempt, failedScore, marginsOf, type RunFile, scoreRoutines, summary, unreadList, verdict, wholeCount } from './score';
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

  test('reads a list in a fenced block as written, escapes and all', () => {
    const odd = { ...list, streams: [{ ...list.streams[0], name: 'Orders & returns', what: 'Pay INV\\_7 by "Friday"' }] };
    const fenced = `Draft routines.\n\nThe streams of work a step found in the user's last 30 days of mail, those they would most regret missing first:\n<untrusted>\n\n\`\`\`json\n${JSON.stringify(odd).replace(/&/g, '\\u0026')}\n\`\`\`\n\n</untrusted>`;
    const row = { direction: 'to_runtime', created_at: '2026-11-20 10:00:00+00', content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: fenced }] } } };
    expect(workListOf([row])).toEqual(odd);
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

  test('reads only what the harness sent a runtime', () => {
    expect(workListOf([prompt(list, '2026-11-20 10:00:00+00', 'to_server')])).toBeUndefined();
  });

  test('fails on a brief that says it carries a list the bench cannot read', () => {
    // An empty list would score as a step that found nothing; the brief and the bench have drifted apart instead.
    expect(() => workListOf([prompt({})])).toThrow("hasn't the list's shape");
    expect(() => workListOf([prompt({ person: 'x', streams: [{ name: 'y' }] })])).toThrow("hasn't the list's shape");
    // Fields of the right kind, down to their items.
    expect(() => workListOf([prompt({ ...list, streams: [{ ...list.streams[0], senders: [{}] }] })])).toThrow("hasn't the list's shape");
    expect(() => workListOf([prompt({ ...list, streams: [{ ...list.streams[0], examples: [{}] }] })])).toThrow("hasn't the list's shape");
    expect(() => workListOf([prompt({ ...list, streams: [{ ...list.streams[0], labels: [3] }] })])).toThrow("hasn't the list's shape");
    const unparsed = { ...prompt(list), content: { ...prompt(list).content, params: { prompt: [{ type: 'text', text: briefOf(list).replace('{"person"', '{person') }] } } };
    expect(() => workListOf([unparsed])).toThrow("isn't JSON");
    const bare = { ...prompt(list), content: { ...prompt(list).content, params: { prompt: [{ type: 'text', text: briefOf(list).replace(/<untrusted>\n\{[\s\S]*$/, '') }] } } };
    expect(() => workListOf([bare])).toThrow('no <untrusted> block');
    expect(readWorkList([prompt({})])).toEqual({ error: "a brief's work list hasn't the list's shape (finding.ts WORK_LIST)" });
    expect(readWorkList([prompt(list)])).toEqual({ list });
  });

  test('reads a list whose brief came with markdown escapes', () => {
    const escaped = (value: unknown) => ({
      direction: 'to_runtime',
      created_at: '2026-11-20 10:00:00+00',
      content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: briefOf(value).replaceAll('_', '\\_') }] } },
    });
    const quoted = { ...list, streams: [{ ...list.streams[0], what: 'Orders "rush\\_" a\\b / c_d' }] };
    expect(workListOf([escaped(quoted)])).toEqual(quoted);
  });

  test('takes the mark inside mail for mail, not for a list', () => {
    const mailed = (text: string) => ({ direction: 'to_runtime', created_at: '2026-11-20 10:00:00+00', content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text }] } } });
    const subject = '2026-11-19 Bo: Fwd: The streams of work a step found are in the deck';
    // A picking brief: the mail mentions the mark, and no list follows it.
    expect(workListOf([mailed(`Pick routines.\n<untrusted>\n${subject}\n</untrusted>`)])).toBeUndefined();
    // A drafting brief whose mail mentions it too still reads its list.
    expect(workListOf([mailed(briefOf(list).replace('\nmail\n', `\n${subject}\n`))])).toEqual(list);
  });

  test('takes the mark quoted in a line, as a dismissed routine\'s name, for a name', () => {
    const brief = (rest: string) => ({ direction: 'to_runtime', created_at: '2026-11-20 10:00:00+00', content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: `Already suggested or dismissed, never to suggest again (catalog keys and routine names):\n["The streams of work a step found"]\n\nConnected apps:\n<untrusted>\n["Linear"]\n</untrusted>${rest}` }] } } });
    expect(workListOf([brief('')])).toBeUndefined();
    expect(workListOf([brief(`\n\n${briefOf(list).slice(briefOf(list).indexOf('The streams'))}`)])).toEqual(list);
  });

  test('finds none where no session read a list', () => {
    expect(workListOf([{ direction: 'to_runtime', content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'Draft routines.\n<untrusted>\nmail\n</untrusted>' }] } } }])).toBeUndefined();
  });
});

const found = (name: string, count = 4): FoundStream => ({ name, senders: [{ name: 'Bo', email: 'bo@acme.example' }], count, cadence: 'weekly', what: '', action: '', handled_by: '', labels: [], keeps: '', examples: [] });
const listOf = (...names: string[]): WorkList => ({ person: 'Ana', streams: names.map((name) => found(name)) });
const entry = (n: number, stream: string, also: string[] = []): EntryMark => ({ n, stream, also, why: '' });
const keyed = (): Persona => ({ ...persona(1, 1), streamsTruth: streams });

describe('rereadList', () => {
  const list = { person: 'Runs a bakery', streams: [{ name: 'Supplier orders', senders: [], count: 9, cadence: '', what: '', action: '', handled_by: '', labels: [], keeps: '', examples: [] }] };
  const row = { direction: 'to_runtime', created_at: '2026-11-20 10:00:00+00', content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: `The streams of work a step found in the user's last 30 days of mail, those they would most regret missing first:\n<untrusted>\n${JSON.stringify(list)}\n</untrusted>` }] } } };
  // rereadList reads and writes only these of a generation.
  const generation = (fields: Pick<Generation, 'transcript' | 'workList'>) => fields as Generation;

  test('reads a moved run\'s transcript beside its run file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reread-'));
    try {
      writeFileSync(join(dir, 'gen-1.jsonl'), `${JSON.stringify(row)}\n`);
      const g = generation({ transcript: '/gone/before/gen-1.jsonl' });
      expect(rereadList(g, join(dir, 'run.json'))).toBeUndefined();
      expect(g.workList).toEqual(list);
      expect(g.listError).toBeUndefined();
      writeFileSync(join(dir, 'gen-1.jsonl'), 'not json\n');
      expect(rereadList(g, join(dir, 'run.json'))).toBeUndefined();
      expect(g.workList).toBeUndefined();
      expect(g.listError).toContain('reading');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never erases a list the run read with a transcript that shows less', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reread-'));
    const file = join(dir, 'gen-1.jsonl');
    const picking = { ...row, content: { ...row.content, params: { prompt: [{ type: 'text', text: 'Pick routines.\n<untrusted>\nmail\n</untrusted>' }] } } };
    try {
      // Empty, or only rows that aren't prompts (null among them): unknown, the run's list stands, and with none it is an error.
      for (const text of ['', 'null\n{"direction":"to_server"}\n']) {
        writeFileSync(file, text);
        const kept = generation({ transcript: file, workList: list });
        expect(rereadList(kept, join(dir, 'run.json'))).toContain('holds no prompt');
        expect(kept.workList).toEqual(list);
        expect(kept.listError).toBeUndefined();
        const none = generation({ transcript: file });
        expect(rereadList(none, join(dir, 'run.json'))).toContain('holds no prompt');
        expect(none.listError).toContain('unknown');
      }
      // Prompts with no list (the picking session's, one with no params, one of metadata
      // alone): the run's reading stands, whether a list, an error or none read.
      const prompt = (params: unknown) => JSON.stringify({ ...row, content: { method: 'session/prompt', ...(params === undefined ? {} : { params }) } });
      writeFileSync(file, `${JSON.stringify(picking)}\n${prompt(undefined)}\n${prompt({ prompt: [{ type: 'text', text: 'invocation: onboarding' }] })}\n`);
      const partial = generation({ transcript: file, workList: list });
      expect(rereadList(partial, join(dir, 'run.json'))).toContain('stands');
      expect(partial.workList).toEqual(list);
      const failed = { ...generation({ transcript: file }), listError: 'an old reader failed' };
      expect(rereadList(failed, join(dir, 'run.json'))).toContain('stands');
      expect(failed.listError).toBe('an old reader failed');
      const none = generation({ transcript: file });
      expect(rereadList(none, join(dir, 'run.json'))).toContain('stands');
      expect(none.workList).toBeUndefined();
      expect(none.listError).toBeUndefined();
      // A list found replaces an error the run had.
      writeFileSync(file, `${JSON.stringify(row)}\n`);
      const corrected = { ...generation({ transcript: file }), listError: 'an old reader failed' };
      expect(rereadList(corrected, join(dir, 'run.json'))).toBeUndefined();
      expect(corrected.workList).toEqual(list);
      expect(corrected.listError).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps the list a run read when its transcript is gone, and calls none read unknown', () => {
    const kept = generation({ transcript: '/gone/gen-1.jsonl', workList: list });
    expect(rereadList(kept, '/gone/run.json')).toContain('is gone');
    expect(kept.workList).toEqual(list);
    expect(kept.listError).toBeUndefined();
    const none = generation({ transcript: '/gone/gen-1.jsonl' });
    expect(rereadList(none, '/gone/run.json')).toContain('is gone');
    expect(none.listError).toContain('unknown');
  });
});

describe('unreadList', () => {
  test('marks a list that could not be read as not judged, never as an empty list', () => {
    const attempt = { generation: { listError: 'no block' }, finding: { found: 0 }, findingMarks: [] } as unknown as Attempt;
    expect(unreadList(attempt)).toBe(true);
    expect(attempt.finding).toBeUndefined();
    expect(attempt.findingMarks).toBeUndefined();
    expect(attempt.findingError).toBe('reading the list: no block');
    const read = { generation: {} } as unknown as Attempt;
    expect(unreadList(read)).toBe(false);
    expect(read.findingError).toBeUndefined();
  });
});

describe('wholeCount', () => {
  test('takes whole numbers of 1 or more', () => {
    expect(wholeCount('--reps', '3')).toBe(3);
    expect(wholeCount('--reps', 2)).toBe(2);
    expect(wholeCount('--reps', '1000')).toBe(1000);
    for (const bad of ['0', '-1', '1.5', 'x', '', ' 3', '3e0', '0x3', '1.0000000000000001', '1001', '4294967296', '9007199254740993']) expect(() => wholeCount('--reps', bad)).toThrow('--reps takes a whole number from 1 to 1000');
  });
});

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
  test('reads a seat address back whatever its case', () => {
    expect(asWritten(persona(1, 1), 'Bo@ACME-S2-Signup.Example')).toBe('Bo@acme.example');
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

  test('shows a held-out list score only over two people\'s read lists', () => {
    const heldout = (persona: string, over: Partial<Attempt> = {}) => attempt({ persona, heldout: true, ...over });
    const list = scoreWorkList(keyed(), listOf('a', 'b'), [entry(1, 's1'), entry(2, 's2')]);
    const unread = scoreWorkList(keyed(), undefined, []);
    const run: RunFile = { section: 'routines', label: 't', set: 'h', commit: 'c', attempts: [heldout('p1', { finding: list }), heldout('p2', { findingError: 'judge' })] } as RunFile;
    const shown = lines([run]).join('\n');
    expect(shown).toContain("1 held-out people's work lists read and judged, fewer than 2: not shown");
    expect(shown).not.toContain('named 100%');
    // An unread list scores as an empty one: beside it, the one read list's entries would show.
    const beside = lines([{ ...run, attempts: [heldout('p1', { finding: list }), heldout('p2', { finding: unread })] }]).join('\n');
    expect(beside).toContain("1 held-out people's work lists read and judged, fewer than 2: not shown");
    expect(beside).not.toContain('entries naming none');
    // No read list at all is fewer than two too.
    const none = lines([{ ...run, attempts: [heldout('p1', { finding: unread }), heldout('p2', { findingError: 'judge' })] }]).join('\n');
    expect(none).toContain("0 held-out people's work lists read and judged, fewer than 2: not shown (1 not judged)");
    expect(none).not.toContain('entries naming none');
    const two = lines([{ ...run, attempts: [heldout('p1', { finding: list }), heldout('p2', { finding: list })] }]).join('\n');
    expect(two).toContain('named 100%');
  });

  test('shows a held-out time or quality only over two people who have one', () => {
    const heldout = (persona: string, over: Partial<Attempt> = {}) => attempt({ persona, heldout: true, ...over });
    const timed = (persona: string, rep = 1) =>
      heldout(persona, { rep, generation: { ...generation([]), status: 'ready', firstMs: 7000, lastMs: 12000, wallMs: 12000 }, score: { ...failedScore(3), quality: 0.75 } });
    const one = summary([timed('p1'), heldout('p2')]);
    expect([one.firstMedianMs, one.lastMedianMs, one.wallMedianMs, one.quality].every(Number.isNaN)).toBe(true);
    const row = lines([{ section: 'routines', label: 't', set: 'h', commit: 'c', attempts: [timed('p1'), heldout('p2')] } as RunFile]).join('\n');
    expect(row).not.toContain('7s');
    expect(row).not.toContain('0.75');
    expect(summary([timed('p1'), timed('p2'), heldout('p3')])).toMatchObject({ firstMedianMs: 7000, lastMedianMs: 12000, wallMedianMs: 12000, quality: 0.75 });
    // A feed rating missing from one generation counts 0, so one person's rating beside it would show.
    const rated = (persona: string) => heldout(persona, { section: 'feed', score: { ...failedScore(3), feedRating: 9 } });
    expect(summary([rated('p1'), heldout('p2', { section: 'feed' })]).feedRating).toBeNaN();
    expect(summary([rated('p1'), rated('p2'), heldout('p3', { section: 'feed' })]).feedRating).toBe(6);
    expect(summary([attempt({ score: { ...failedScore(3), feedRating: 9 } }), attempt({ persona: 'other' })]).feedRating).toBe(4.5);
    const margins = { score: 1, found: 1, bad: 1 };
    const side = [timed('p1'), timed('p1', 2), heldout('p2'), heldout('p2', { rep: 2 })];
    expect(verdict(side, side, margins).wallRatio).toBeNaN();
    const both = [timed('p1'), timed('p2'), heldout('p1', { rep: 2 })];
    expect(verdict(both, both, margins).wallRatio).toBe(1);
    // Only people timed on both sides: p3, timed in B alone, moves nothing (over all three B's median would be 90 s).
    const slow = (persona: string) => heldout(persona, { generation: { ...generation([]), status: 'ready', wallMs: 90000 }, score: failedScore(3) });
    expect(verdict([timed('p1'), timed('p2'), heldout('p3')], [timed('p1'), slow('p2'), slow('p3')], margins).wallRatio).toBe(51000 / 12000);
    expect(verdict([timed('p1'), heldout('p2'), heldout('p3')], [timed('p1'), slow('p2'), slow('p3')], margins).wallRatio).toBeNaN();
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

  test('starts no job after one fails, and throws once the running ones end', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    // Jobs 0 and 2 hold until released; job 1 fails while they run.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let failed!: () => void;
    const failure = new Promise<void>((resolve) => (failed = resolve));
    const jobs = Array.from({ length: 8 }, (_, i) => async () => {
      started.push(i);
      if (i === 1) {
        failed();
        throw new Error('job 1 failed');
      }
      await held;
      finished.push(i);
      return i;
    });
    let settled = false;
    const pool = pooled(jobs, 3).finally(() => (settled = true));
    await failure;
    // Every turn of the event loop that could settle it without the held jobs has run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await expect(pool).rejects.toThrow('job 1 failed');
    expect(started).toEqual([0, 1, 2]);
    expect(finished).toEqual([0, 2]);
    expect(await pooled([async () => 1, async () => 2], 3)).toEqual([1, 2]);
  });

  test('refuses a roster where two people share a first name, whatever its case, or a colleague is named Owner', () => {
    const roster = (owner: string, ...firsts: string[]) => ({ owner_first: owner, colleagues: firsts.map((first) => ({ first, last: 'A', role: '' })) });
    expect(rosterProblem(roster('Ana', 'Bo', 'ana'))).toContain('share a first name');
    expect(rosterProblem(roster('Ana', 'Bo', 'BO'))).toContain('share a first name');
    expect(rosterProblem(roster('Ana', 'Bo', 'owner'))).toContain('named Owner');
    expect(rosterProblem(roster('Owen', 'Bo', 'Cy'))).toBeUndefined();
  });
});

describe('a held-out person is someone no earlier set has', () => {
  const taken = new Set(['slug:ana', 'name:ana lopez', 'domain:acme.example']);
  const person = { slug: 'bea', owner_first: 'Bea', owner_last: 'Stone', domain: 'stone.example' };
  test('a new slug, name and domain pass', () => expect(repeatsEarlier([person], taken)).toEqual([]));
  test('the same slug, full name or mail domain is refused, saying which', () => {
    expect(repeatsEarlier([{ ...person, slug: 'ana' }], taken)).toEqual(['slug']);
    expect(repeatsEarlier([{ ...person, owner_first: 'ANA', owner_last: 'Lopez' }], taken)).toEqual(['name']);
    expect(repeatsEarlier([{ ...person, domain: 'Acme.example' }], taken)).toEqual(['domain']);
    // Two people of one set are two people too.
    expect(repeatsEarlier([person, { ...person, slug: 'cy', owner_first: 'Cy' }], taken)).toEqual(['domain']);
    expect(repeatsEarlier([person, { slug: 'cy', owner_first: 'Cy', owner_last: 'Moss', domain: 'moss.example' }], taken)).toEqual([]);
  });
});
