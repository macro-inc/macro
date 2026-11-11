import { expect, test } from 'bun:test';
import { formatReport, loopLag, readEvents, resolveCall } from '../report.ts';

test('report shows the timeline and answer latency', () => {
  const report = formatReport([
    { t: 0, type: 'room.joined', room: 'abc' },
    ...[1, 2, 3, 4, 5].map((second) => ({
      t: second * 1000,
      type: 'audio.level',
      who: 'macro|owner@x',
      dbfs: -60,
    })),
    { t: 3500, type: 'user.state', from: 'listening', to: 'speaking' },
    { t: 3900, type: 'user.state', from: 'speaking', to: 'listening' },
    { t: 4300, type: 'stt.final', text: 'Hello?' },
    { t: 5300, type: 'agent.state', from: 'listening', to: 'speaking' },
    { t: 4400, type: 'turn.ask', turn: 1, text: 'Hello?' },
    { t: 5300, type: 'tts.first_audio', turn: 1 },
    { t: 5300, type: 'brain.text', turn: 1, text: "Yeah, I'm here." },
  ]);
  expect(report).toContain('00:00.0  room.joined room=abc');
  expect(report).toContain('00:01.0  level owner dBFS/s: -60 -60 -60 -60 -60');
  expect(report).toContain('-> ask turn 1: Hello?');
  expect(report).toContain("assistant: Yeah, I'm here.");
  expect(report).toContain('asks 1, answered aloud 1, interrupts 0');
  expect(report).toContain('ask -> first audio: median 900 ms, max 900 ms');
  expect(report).toContain('stopped talking -> first word: median 1400 ms');
  expect(report).toContain('stt finals 1, false interruptions 0');
});

test('interim transcripts only when asked for', () => {
  const events = [
    { t: 100, type: 'stt.interim', who: 'macro|owner@x', text: 'Hel' },
  ];
  expect(formatReport(events)).not.toContain('Hel');
  expect(formatReport(events, { all: true })).toContain(
    '00:00.1  owner ...Hel'
  );
});

test('a join that never reached the room shows in the report', () => {
  const report = formatReport([
    { t: 0, type: 'join.start', kind: 'channel', id: 'ch' },
    { t: 190, type: 'join.secrets', ms: 190 },
    {
      t: 2190,
      type: 'join.token',
      attempt: 1,
      ms: 2000,
      error: 'timed out after 2000 ms',
    },
    {
      t: 2600,
      type: 'join.token',
      attempt: 2,
      ms: 160,
      error: 'join channel: undefined {"code":"ConnectionRefused"}',
    },
    { t: 2900, type: 'join.token', attempt: 3, ms: 140 },
    {
      t: 9000,
      type: 'join.failed',
      stage: 'token',
      error: 'ConnectionRefused',
    },
    { t: 9100, type: 'watch.join_exit', code: 1, failures: 1 },
    { t: 9200, type: 'watch.join_exit', code: 0, failures: 0 },
  ]);
  expect(report).toContain('token attempt 1: FAILED after 2000 ms: timed out');
  expect(report).toContain('token attempt 3: ok in 140 ms');
  expect(report).toContain('JOIN FAILED at token: ConnectionRefused');
  expect(report).toContain(
    'watcher: join exited 1 (failure 1, rejoining while the call is live)'
  );
  expect(report).toContain('00:09.2  watcher: join exited 0\n');
  expect(report).toContain('JOIN FAILED 1x: token: ConnectionRefused');
});

test('report shows how late the thread got, and says nothing for a call that never watched', () => {
  const watch = { t: 0, type: 'loop.watch', everyMs: 50, logMs: 100 };
  expect(loopLag([{ t: 0, type: 'call.start' }])).toBeNull();
  expect(formatReport([{ t: 0, type: 'call.start' }])).not.toContain(
    'event loop'
  );
  expect(formatReport([watch])).toContain('event loop: never 100 ms late');
  const report = formatReport([
    watch,
    { t: 1, type: 'loop.lag', ms: 180 },
    { t: 2, type: 'loop.lag', ms: 11500 },
  ]);
  expect(report).toContain('event loop: max 11500 ms, 1 stalls over 500 ms');
});

test('report says when the disk cost recording, and counts errors', () => {
  const report = formatReport([
    { t: 1, type: 'recording.dropped', who: 'a', ms: 900 },
    { t: 2, type: 'recording.dropped', who: 'b', ms: 100 },
    { t: 3, type: 'log.dropped', events: 4 },
    { t: 4, type: 'session.error', error: 'tts' },
    { t: 5, type: 'session.error', error: 'tts' },
  ]);
  expect(report).toContain(
    'disk too slow: dropped 1000 ms of recording, 4 events'
  );
  expect(report).toContain('errors 2: session.error');
});

test("a call's events are read from its log; a line cut off mid-write is dropped", async () => {
  const disk = {
    read: async (path: string) =>
      path === 'c1'
        ? '{"t":0,"type":"call.start"}\n{"t":5,"type":"brain.text","text":"Hi."}\n{"t":9,"ty'
        : undefined,
  };
  expect(await readEvents(disk, 'c1')).toEqual([
    { t: 0, type: 'call.start' },
    { t: 5, type: 'brain.text', text: 'Hi.' },
  ]);
  expect(await readEvents(disk, 'c2')).toBeUndefined();
});

test('a call is named by its id or a prefix only it has', () => {
  const ids = ['01aa98-aaaa', '01aa87-bbbb', '01aa8f-cccc', '01aa'];
  expect(resolveCall(ids, '01aa9')).toBe('01aa98-aaaa');
  expect(resolveCall(ids, '01aa')).toBe('01aa');
  expect(() => resolveCall(ids, '01aa8')).toThrow('ambiguous call id');
  expect(() => resolveCall(ids, 'ffff')).toThrow('no call ffff');
});
