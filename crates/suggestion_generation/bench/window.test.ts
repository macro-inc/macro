import { describe, expect, test } from 'bun:test';
import type { RoutineMark } from './judge';
import { type Inbox, type Persona, recentMessages, type RoutinesTruth, type StreamsTruth, windowMessages } from './personas';
import { type Generation, type RoutineRow, workListOf } from './run';
import { mailText } from './finding';
import { type Attempt, scoreRoutines, summary } from './score';
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
  const brief = `Draft routines.\n<untrusted>\nmail\n</untrusted>\n\nThe streams of work a step found in the user's last 30 days of mail, those they would most regret missing first:\n<untrusted>\n${JSON.stringify(list)}\n</untrusted>`;

  test('reads the list a drafting session was briefed with', () => {
    const rows = [
      { content: { type: 'event', event: 'acp_ready' } },
      { content: { type: 'acp', method: 'session/prompt', params: { prompt: [{ type: 'text', text: brief }] } } },
    ];
    expect(workListOf(rows)).toEqual(list);
  });

  test('finds none where no session read a list', () => {
    expect(workListOf([{ content: { type: 'acp', params: { prompt: [{ type: 'text', text: 'Draft routines.\n<untrusted>\nmail\n</untrusted>' }] } } }])).toBeUndefined();
  });
});
