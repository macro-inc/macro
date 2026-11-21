import { describe, expect, test } from 'bun:test';
import type { JobMark, RoutineMark } from './judge';
import { followedUp, replySubject, sentDelay } from './month';
import { type Inbox, type Persona, type RoutinesTruth, SENT_MESSAGES, SENT_TEXTS, type SentMessage, type StreamsTruth, hasSent, sentMessages, variantOf, windowMessages } from './personas';
import type { Generation, RoutineRow } from './run';
import { type Attempt, failedScore, marginsOf, noiseMargins, scoreRoutines, summary, verdict } from './score';
import { ANCHOR } from './clock';

const HOUR = 60 * 60_000;

/** A person with `received` inbox messages and `sent` sent ones, one an hour, newest first. */
function persona(received: number, sent: number): Persona {
  const message = (i: number, folder: 'INBOX' | 'SENT') => ({
    from: folder === 'SENT' ? { name: 'Ana Ruiz', email: 'ana@acme.example' } : { name: 'Bo', email: 'bo@vendor.example' },
    to: [folder === 'SENT' ? 'bo@vendor.example' : 'ana@acme.example'],
    cc: [],
    date: new Date(ANCHOR - (i + 1) * HOUR).toISOString(),
    subject: `${folder} ${i + 1}`,
    labels: [folder],
    snippet: `Text ${i + 1}`,
  });
  const inbox: Inbox = {
    owner: { name: 'Ana Ruiz', email: 'ana@acme.example' },
    persona: 'test',
    timezone: 'UTC',
    messages: Array.from({ length: received }, (_, i) => message(i, 'INBOX')),
    ...(sent ? { sent: Array.from({ length: sent }, (_, i): SentMessage => ({ ...message(i, 'SENT'), kind: 'reply' })) } : {}),
  };
  return { name: 'test', seat: 1, heldout: false, dir: '', workspace: { scenario: 't', description: '', users: {} }, inbox };
}

describe('the sent read', () => {
  test('serves what they sent, newest first, up to its limit, with text on the newest', () => {
    const { messages } = sentMessages(persona(3, SENT_MESSAGES + 40), 'full', ANCHOR);
    expect(messages).toHaveLength(SENT_MESSAGES);
    expect(messages[0].subject).toBe('SENT 1');
    expect(messages.every((m) => m.from.email === 'ana@acme.example')).toBe(true);
    expect(messages.slice(0, SENT_TEXTS).every((m) => typeof m.snippet === 'string')).toBe(true);
    expect(messages.slice(SENT_TEXTS).every((m) => m.snippet === null)).toBe(true);
  });

  test("leaves the inbox read as it was: sent mail never shows in it", () => {
    const both = persona(5, 5);
    const inboxOnly = persona(5, 0);
    expect(windowMessages(both, 'full', ANCHOR)).toEqual(windowMessages(inboxOnly, 'full', ANCHOR));
  });

  test('is empty for a person written without sent mail', () => {
    expect(hasSent(persona(5, 0))).toBe(false);
    expect(sentMessages(persona(5, 0), 'full', ANCHOR).messages).toEqual([]);
  });

  test("moves a later seat's sent mail to the seat's domain, as its inbox", () => {
    const seat = variantOf({ ...persona(1, 1), seat: 2 }, 'full');
    expect(seat.inbox.sent![0].from.email).toBe('ana@acme-s2.example');
    expect(sentMessages({ ...persona(1, 1), seat: 2 }, 'full', ANCHOR).messages[0].from.email).toBe('ana@acme-s2.example');
  });
});

describe('the sent mail a month writer derives', () => {
  test('answers the plan\'s count of a stream, spread over its messages', () => {
    const month = Array.from({ length: 10 }, (_, i) => i);
    expect(followedUp(month, 3)).toEqual([1, 5, 8]);
    expect(followedUp(month, 10)).toEqual(month);
    expect(followedUp(month, 25)).toEqual(month);
    expect(followedUp(month, 0)).toEqual([]);
    expect(followedUp([], 4)).toEqual([]);
  });

  test('puts one Re: before a subject', () => {
    expect(replySubject('Invoice 42')).toBe('Re: Invoice 42');
    expect(replySubject('RE: Invoice 42')).toBe('RE: Invoice 42');
    expect(replySubject(' re:Invoice')).toBe(' re:Invoice');
  });

  test('sends a reply the same time after its message every time, inside the delay', () => {
    const delays = Array.from({ length: 200 }, (_, i) => sentDelay(`p s1 ${i}`));
    expect(delays).toEqual(Array.from({ length: 200 }, (_, i) => sentDelay(`p s1 ${i}`)));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(20 * 60_000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(9 * HOUR);
    expect(new Set(delays).size).toBeGreaterThan(150);
  });
});

const row = (catalog_key: string | null): RoutineRow => ({ catalog_key, surfaces: ['tasks'], knob_values: {}, reason: 'r', routine: catalog_key ? null : {} }) as unknown as RoutineRow;
const generation = (routines: RoutineRow[]): Generation => ({ routines, now: ANCHOR, variant: 'full', timezone: 'UTC', status: 'ready', cost: { usd: 0 } }) as unknown as Generation;
const mark = (over: Partial<RoutineMark> = {}): RoutineMark => ({
  suggestion: 'S1', meets: [], decoys: [], keep: 3, misfit: false, broken: false, bad_knob: false, wrong_surface: false, duplicate: false, unsafe: false, invented: false, why: '', ...over,
});
const jobs = (...each: string[][]): JobMark[] => each.map((ids, i) => ({ suggestion: `S${i + 1}`, jobs: ids, why: '' }));
const truth: RoutinesTruth = { needs: [{ id: 'n1', what: '', evidence: [], catalog: [], surfaces: ['email'] }], decoys: [], fine: [], misfit: [] };
const streams: StreamsTruth = {
  streams: (['work', 'work', 'work', 'noise'] as const).map((kind, i) => ({ id: `s${i + 1}`, kind, name: '', senders: [], count: 1, cadence: '', what: '', action: '', labels: [], examples: [] })),
};

describe('good drafts by stream job', () => {
  test('count drafts with nothing wrong that do a work stream\'s job, bundled into a need or not', () => {
    const score = scoreRoutines(
      generation([row(null), row(null), row(null), row(null), row('triage')]),
      // Two good by job (one meets no need), one flawed, one doing only a noise stream's; the pick counts apart.
      [mark({ meets: ['n1'] }), mark(), mark({ broken: true }), mark(), mark()],
      truth,
      streams,
      jobs(['s1'], ['s2', 's3'], ['s1'], ['s4'], ['s1']),
    );
    expect(score).toMatchObject({ goodDrafts: 1, jobDrafts: 2, jobPicks: 1, jobStreams: 3 });
  });

  test('are left out where the run had no jobs judgement', () => {
    const score = scoreRoutines(generation([row(null)]), [mark({ meets: ['n1'] })], truth, streams);
    expect(score.jobDrafts).toBeUndefined();
    const attempt: Attempt = { section: 'routines', label: 't', persona: 'p', heldout: false, rep: 1, generation: generation([row(null)]), judgeUsd: 0, score };
    expect(summary([attempt]).jobDrafts).toBeUndefined();
  });
});

describe('margins for good drafts', () => {
  test('take five finite margins, or three', () => {
    expect(marginsOf('10,0.5,0.2,0.4,0.6')).toEqual({ score: 10, found: 0.5, bad: 0.2, goodDrafts: 0.4, jobDrafts: 0.6 });
    expect(marginsOf('10,0.5,0.2')).toEqual({ score: 10, found: 0.5, bad: 0.2 });
    for (const bad of ['1,2,3,4', '1,2,3,4,-1', '1,2,3,4,5,6']) expect(() => marginsOf(bad)).toThrow('--margins takes');
  });

  const attempts = (persona: string, values: [number, number][]): Attempt[] =>
    values.map(([good, byJob], rep) => ({
      section: 'routines',
      label: 't',
      persona,
      heldout: false,
      rep,
      generation: generation([]),
      judgeUsd: 0,
      score: { score: 0, needs: 1, found: 0, missed: [], suggestions: 0, bad: 0, invented: 0, wrong: {}, quality: null, drafts: 0, goodDrafts: good, goodPicks: 0, jobDrafts: byJob, jobPicks: 0, jobStreams: 0 },
    }));

  test('judge a gain in good drafts past its margin, and say unmeasured without one', () => {
    const a = [...attempts('p', [[1, 1], [1, 2], [2, 1]]), ...attempts('q', [[0, 1], [1, 1], [1, 0]])];
    const b = [...attempts('p', [[4, 5], [5, 5], [4, 6]]), ...attempts('q', [[4, 4], [3, 5], [4, 4]])];
    const measured = verdict(a, b, marginsOf('10,1,1,1,1'));
    expect(measured.good.goodDrafts?.verdict).toBe('better');
    expect(measured.good.jobDrafts?.verdict).toBe('better');
    expect(verdict(a, b, marginsOf('10,1,1')).good.goodDrafts?.verdict).toBe('unmeasured');
    expect(verdict(a, b, marginsOf('10,1,1,9,9')).good.jobDrafts?.verdict).toBe('noise');
    const noise = noiseMargins(a, a);
    expect(noise.goodDrafts?.margin).toBeGreaterThan(0);
    expect(noise.jobDrafts?.delta).toBe(0);
  });
});

describe('the jobs measure over a run', () => {
  const judged = (persona: string, rep: number, jobDrafts: number): Attempt => ({
    section: 'routines',
    label: 't',
    persona,
    heldout: false,
    rep,
    generation: generation([row(null)]),
    judgeUsd: 0,
    jobMarks: jobs(['s1']),
    score: { score: 0, needs: 1, found: 0, missed: [], suggestions: 1, bad: 0, invented: 0, wrong: {}, quality: null, drafts: 1, goodDrafts: jobDrafts, goodPicks: 0, jobDrafts, jobPicks: 0, jobStreams: jobDrafts },
  });
  // Routines judged and scored, its jobs judgement failed: no jobs measure.
  const jobless = (persona: string, rep: number): Attempt => {
    const attempt = judged(persona, rep, 0);
    const { jobDrafts, jobPicks, jobStreams, ...score } = attempt.score!;
    return { ...attempt, jobMarks: undefined, jobError: 'judge timed out', score };
  };

  test("counts a failed build of a month persona as doing no stream's job", () => {
    expect(failedScore(3, streams)).toMatchObject({ jobDrafts: 0, jobPicks: 0, jobStreams: 0, aimed: 0, workStreams: streams.streams.filter((s) => s.kind === 'work').length });
    expect(failedScore(3).jobDrafts).toBeUndefined();
    const failed: Attempt = { ...judged('p', 2, 0), jobMarks: undefined, generation: { ...generation([]), buildFailed: true }, score: failedScore(1, streams) };
    expect(summary([judged('p', 1, 4), failed])).toMatchObject({ jobDrafts: 2, jobScored: 2, jobErrors: 0 });
  });

  test('leaves an attempt whose jobs judgement failed out of the jobs measure only', () => {
    const s = summary([judged('p', 1, 4), jobless('p', 2)]);
    expect(s).toMatchObject({ scored: 2, goodDrafts: 2, jobDrafts: 4, jobScored: 1, jobErrors: 1 });
  });

  test('shows a held-out jobs measure only over two held-out people or more', () => {
    const held = (attempt: Attempt): Attempt => ({ ...attempt, heldout: true });
    const s = summary([held(judged('p', 1, 4)), held(jobless('q', 1)), held(jobless('q', 2))]);
    expect(s.goodDrafts).toBeDefined();
    expect(s).toMatchObject({ jobWithheld: 1, jobErrors: 2 });
    expect(s.jobDrafts).toBeUndefined();
    expect(summary([held(judged('p', 1, 4)), held(judged('q', 1, 2))])).toMatchObject({ jobDrafts: 3, jobScored: 2 });
  });

  test('leaves out, and never stops on, a jobs measure the sides share no person for', () => {
    const a = [judged('p', 1, 1), judged('p', 2, 1), jobless('q', 1), jobless('q', 2)];
    const b = [jobless('p', 1), jobless('p', 2), judged('q', 1, 4), judged('q', 2, 4)];
    const v = verdict(a, b, marginsOf('10,1,1,1,1'));
    expect(v.good.jobDrafts).toBeUndefined();
    expect(v.unshared).toEqual(['jobDrafts']);
    expect(v.good.goodDrafts?.attempts).toEqual([4, 4]);
    expect(noiseMargins(a, b).jobDrafts).toBeUndefined();
  });

  test('compares a held-out jobs measure only over two held-out people both sides share', () => {
    const held = (attempt: Attempt): Attempt => ({ ...attempt, heldout: true });
    const a = [judged('p', 1, 1), judged('p', 2, 1), jobless('q', 1), judged('q', 2, 2)].map(held);
    const b = [judged('p', 1, 4), judged('p', 2, 4), judged('q', 1, 3), jobless('q', 2)].map(held);
    expect(verdict(a, b, marginsOf('10,1,1,1,1')).good.jobDrafts?.people).toBe(2);
    const onlyP = [judged('p', 1, 4), judged('p', 2, 4), jobless('q', 1), jobless('q', 2)].map(held);
    const v = verdict(a, onlyP, marginsOf('10,1,1,1,1'));
    expect(v.good.jobDrafts).toBeUndefined();
    expect(v.unshared).toEqual(['jobDrafts']);
  });

  test('compares good drafts by stream job over the attempts that have them', () => {
    const a = [judged('p', 1, 1), judged('p', 2, 0), judged('q', 1, 1), judged('q', 2, 1)];
    const b = [judged('p', 1, 5), jobless('p', 2), judged('q', 1, 4), judged('q', 2, 5)];
    const v = verdict(a, b, marginsOf('10,1,1,1,1'));
    expect(v.good.jobDrafts?.attempts).toEqual([4, 3]);
    expect(v.good.goodDrafts?.attempts).toEqual([4, 4]);
    expect(noiseMargins(a, b).jobDrafts?.attempts).toEqual([4, 3]);
  });
});
