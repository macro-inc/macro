import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type Action, type TurnEvent, Turns } from './turns.ts';

const CALLER = { id: 'macro|caller@example.com', name: 'Caller' };
const OTHER = { id: 'macro|other@example.com', name: 'Other' };
/** Drive Turns with a script of [ms, event] and collect [ms, action]. Ticks every 50 ms. */
function run(
  script: [number, TurnEvent][],
  until?: number,
  t = new Turns(['Tod', 'Todd'])
) {
  const out: [number, Action][] = [];
  const end = until ?? Math.max(...script.map(([ms]) => ms)) + 5000;
  let i = 0;
  for (let now = 0; now <= end; now += 50) {
    while (i < script.length && script[i]![0] <= now) {
      for (const a of t.handle(script[i]![1], script[i]![0]))
        out.push([script[i]![0], a]);
      i++;
    }
    for (const a of t.tick(now)) out.push([now, a]);
  }
  return {
    out,
    t,
    asks: out.filter(([, a]) => a.type === 'ask') as [
      number,
      Extract<
        Action,
        {
          type: 'ask';
        }
      >,
    ][],
  };
}
const join = (p: typeof CALLER): TurnEvent => ({
  type: 'joined',
  who: p.id,
  name: p.name,
});
const final = (who: string, text: string, speechFinal = true): TurnEvent => ({
  type: 'stt',
  who,
  ev: { kind: 'final', text, speechFinal },
});
const interim = (who: string, text: string): TurnEvent => ({
  type: 'stt',
  who,
  ev: { kind: 'interim', text },
});
const started = (who: string): TurnEvent => ({
  type: 'stt',
  who,
  ev: { kind: 'speech_started' },
});
const uend = (who: string): TurnEvent => ({
  type: 'stt',
  who,
  ev: { kind: 'utterance_end' },
});
const audio = (playing: boolean): TurnEvent => ({
  type: 'agent_audio',
  playing,
});
const done = (turn: number): TurnEvent => ({ type: 'brain_done', turn });
describe('1:1 calls', () => {
  test('everything the one human says is for Tod, name or not', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Hello?')],
    ]);
    assert.strictEqual(asks.length, 1);
    assert.partialDeepStrictEqual(asks[0]![1], {
      who: CALLER.id,
      name: 'Caller',
      text: 'Hello?',
    });
  });
  test('a question is asked within a second of the speaker pausing', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What are you working on?')],
    ]);
    assert(asks[0]![0] <= 1000 + 1000);
  });
  test('utterance end asks immediately', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Hello?', false)],
      [1100, uend(CALLER.id)],
    ]);
    assert.strictEqual(asks[0]![0], 1100);
  });
  test('call recorded failure: "Hello?" ... "Hello?" ... "Tod." each gets answered', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [3900, final(CALLER.id, 'Hello?')],
      [6000, done(1)],
      [8800, final(CALLER.id, 'Hello?')],
      [11000, done(2)],
      [14900, final(CALLER.id, 'Tod.')],
    ]);
    assert.deepStrictEqual(
      asks.map(([, a]) => a.text),
      ['Hello?', 'Hello?', 'Tod.']
    );
  });
  test('speech with no words gets a "didn\'t catch that", not silence', () => {
    const { out } = run([
      [0, join(CALLER)],
      [3000, { type: 'stt', who: CALLER.id, ev: { kind: 'unheard' } }],
    ]);
    const says = out.filter(([, a]) => a.type === 'say');
    assert.strictEqual(says.length, 1);
  });
  test('"didn\'t catch that" is rate limited and never said while Tod is busy', () => {
    const unheard: TurnEvent = {
      type: 'stt',
      who: CALLER.id,
      ev: { kind: 'unheard' },
    };
    const { out } = run([
      [0, join(CALLER)],
      [1000, unheard],
      [2000, unheard],
      [3000, final(CALLER.id, 'hi')],
      [4500, unheard],
    ]);
    assert.strictEqual(out.filter(([, a]) => a.type === 'say').length, 1);
  });
});
describe('group calls', () => {
  test('unaddressed chatter is heard but not answered', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(OTHER.id, 'Did you see the game?')],
    ]);
    assert.strictEqual(asks.length, 0);
  });
  test('addressing Tod by name gets an answer, with what was said before as context', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(OTHER.id, 'Slack is down again.')],
      [3000, final(CALLER.id, 'Todd, is that us?')],
    ]);
    assert.strictEqual(asks.length, 1);
    assert.strictEqual(asks[0]![1].text, 'Todd, is that us?');
    assert.deepStrictEqual(asks[0]![1].context, [
      'Other: Slack is down again.',
    ]);
  });
  test('his name alone waits for the question that follows', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Tod.')],
      [2500, final(CALLER.id, 'what time is the demo?')],
    ]);
    assert.strictEqual(asks.length, 1);
    assert.strictEqual(asks[0]![1].text, 'Tod. what time is the demo?');
  });
  test('his name alone still gets answered if nothing follows', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Hey Tod.')],
    ]);
    assert.strictEqual(asks.length, 1);
    assert(asks[0]![0] >= 3000);
  });
  test('follow-up window: the asker can reply without his name for 20s after Tod finishes', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Tod, what are you on?')],
      [3000, audio(true)],
      [5000, audio(false)],
      [5000, done(1)],
      [10000, final(CALLER.id, 'Why that first?')],
      [12000, done(2)],
      [12000, final(OTHER.id, 'I think it is fine.')],
      [40000, final(CALLER.id, 'Anyway, lunch?')],
    ]);
    assert.deepStrictEqual(
      asks.map(([, a]) => a.text),
      ['Tod, what are you on?', 'Why that first?']
    );
  });
  test('a call that becomes a group call stops answering everything', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Hello?')],
      [2000, done(1)],
      [30000, join(OTHER)],
      [31000, final(OTHER.id, 'Hi Caller.')],
    ]);
    assert.strictEqual(asks.length, 1);
  });
});
describe('barge-in', () => {
  test('two words over Tod stop his audio and interrupt the brain at the interim', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What are you working on?')],
      [3000, audio(true)],
      [4000, started(CALLER.id)],
      [4300, interim(CALLER.id, 'no wait')],
    ]);
    const at4300 = out.filter(([ms]) => ms === 4300).map(([, a]) => a.type);
    assert.deepStrictEqual(at4300, ['stop_speaking', 'interrupt']);
  });
  test('one backchannel word ("yeah") does not cut him off', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What are you working on?')],
      [3000, audio(true)],
      [4300, interim(CALLER.id, 'yeah')],
      [4600, final(CALLER.id, 'Yeah.')],
    ]);
    assert.strictEqual(
      out.some(([, a]) => a.type === 'interrupt'),
      false
    );
  });
  test('"Stop." alone cuts him off (probe recorded failure: two words took 2 s to arrive)', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Status?')],
      [3000, audio(true)],
      [4300, interim(CALLER.id, 'Stop.')],
    ]);
    assert.deepStrictEqual(
      out.filter(([ms]) => ms === 4300).map(([, a]) => a.type),
      ['stop_speaking', 'interrupt']
    );
  });
  const voiceOf = (who: string): TurnEvent => ({
    type: 'stt',
    who,
    ev: { kind: 'voice' },
  });
  const unheard = (who: string): TurnEvent => ({
    type: 'stt',
    who,
    ev: { kind: 'unheard' },
  });
  test('sustained voice ducks him at once; the first real words stop him', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Status?')],
      [3000, audio(true)],
      [3500, voiceOf(CALLER.id)],
      [3900, interim(CALLER.id, 'Stop.')],
    ]);
    assert.deepStrictEqual(
      out.filter(([ms]) => ms === 3500).map(([, a]) => a),
      [{ type: 'duck', on: true }]
    );
    assert.deepStrictEqual(
      out.filter(([ms]) => ms === 3900).map(([, a]) => a.type),
      ['stop_speaking', 'interrupt']
    );
  });
  test("Caller's call recorded failure regression: a wordless sound over Tod doesn't stop him or get a \"didn't catch that\"", () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Does it replace all of Pipedream?')],
      [3000, audio(true)],
      [5000, voiceOf(CALLER.id)],
      [6500, unheard(CALLER.id)], // rescue found no words
      [9000, audio(false)],
    ]);
    const types = out.map(([, a]) => a.type);
    assert(!types.includes('stop_speaking'));
    assert(!types.includes('interrupt'));
    assert(!types.includes('say'));
    assert.deepStrictEqual(
      out
        .filter(([, a]) => a.type === 'duck')
        .map(([ms, a]) => [
          ms,
          (
            a as {
              on: boolean;
            }
          ).on,
        ]),
      [
        [5000, true],
        [6500, false],
      ]
    );
  });
  test('if no words come, he goes back to full volume after 2 s', () => {
    const { out } = run(
      [
        [0, join(CALLER)],
        [1000, final(CALLER.id, 'Status?')],
        [3000, audio(true)],
        [3500, voiceOf(CALLER.id)],
      ],
      8000
    );
    assert.deepStrictEqual(
      out
        .filter(([, a]) => a.type === 'duck')
        .map(([ms, a]) => [
          ms,
          (
            a as {
              on: boolean;
            }
          ).on,
        ]),
      [
        [3500, true],
        [5500, false],
      ]
    );
    assert.strictEqual(
      out.some(([, a]) => a.type === 'interrupt'),
      false
    );
  });
  test('a backchannel ("Yeah.") over him restores his volume', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Status?')],
      [3000, audio(true)],
      [3500, voiceOf(CALLER.id)],
      [3800, final(CALLER.id, 'Yeah.')],
    ]);
    assert.deepStrictEqual(
      out.filter(([ms]) => ms === 3800).map(([, a]) => a),
      [{ type: 'duck', on: false }]
    );
  });
  test('no "didn\'t catch that" for a sound made just after he stopped talking', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Status?')],
      [3000, audio(true)],
      [5000, audio(false)],
      [5000, done(1)],
      [6000, unheard(CALLER.id)],
    ]);
    assert.strictEqual(
      out.some(([, a]) => a.type === 'say'),
      false
    );
  });
  test('in a group, voice alone from someone else does nothing; from the asker it ducks', () => {
    const a = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Tod, status?')],
      [3000, audio(true)],
      [3500, voiceOf(OTHER.id)],
    ]);
    assert.strictEqual(
      a.out.some(([, x]) => x.type === 'duck' || x.type === 'interrupt'),
      false
    );
    const b = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Tod, status?')],
      [3000, audio(true)],
      [3500, voiceOf(CALLER.id)],
    ]);
    assert.strictEqual(
      b.out.some(([, x]) => x.type === 'duck'),
      true
    );
  });
  test('the asker talking again while Tod is still thinking: the answer waits for the whole line', () => {
    const { out, asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What model are you')],
      [1700, { type: 'stt', who: CALLER.id, ev: { kind: 'voice' } }],
      [2600, final(CALLER.id, 'running on right now?')],
    ]);
    assert.strictEqual(
      out.some(([, x]) => x.type === 'interrupt'),
      true
    );
    assert.strictEqual(
      out.some(([, x]) => x.type === 'stop_speaking'),
      false
    );
    assert.strictEqual(
      asks.at(-1)![1].text,
      'What model are you running on right now?'
    );
  });
  test('voice from someone else while Tod is thinking does nothing', () => {
    const { out } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Tod, status?')],
      [2000, { type: 'stt', who: OTHER.id, ev: { kind: 'voice' } }],
    ]);
    assert.strictEqual(
      out.some(([, x]) => x.type === 'interrupt'),
      false
    );
  });
  test('his name alone cuts him off', () => {
    const { out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'Status?')],
      [3000, audio(true)],
      [4300, interim(CALLER.id, 'Tod')],
    ]);
    assert.strictEqual(
      out.some(([, a]) => a.type === 'interrupt'),
      true
    );
  });
  test('after a barge-in the new line is asked, marked as cutting him off', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What are you working on?')],
      [3000, audio(true)],
      [4300, interim(CALLER.id, 'no stop')],
      [4300, audio(false)],
      [4300, done(1)],
      [4800, final(CALLER.id, 'No, stop. Just the database.')],
    ]);
    assert.strictEqual(asks.length, 2);
    assert.partialDeepStrictEqual(asks[1]![1], {
      text: 'No, stop. Just the database.',
      cutOff: true,
    });
  });
  test('stale brain_done from an interrupted turn does not end the new one', () => {
    const t = new Turns(['Tod', 'Todd']);
    t.handle(join(CALLER), 0);
    t.handle(final(CALLER.id, 'one'), 0);
    t.tick(2000);
    t.handle(audio(true), 2100);
    t.handle(interim(CALLER.id, 'two words'), 2200);
    t.handle(final(CALLER.id, 'two words'), 2300);
    t.tick(4000);
    assert.strictEqual(t.state, 'thinking');
    t.handle(done(1), 4100);
    assert.strictEqual(t.state, 'thinking');
  });
  test('in a group, anyone talking over Tod stops him (Caller, 2026-11-03)', () => {
    const { out } = run([
      [0, join(CALLER)],
      [0, join(OTHER)],
      [1000, final(CALLER.id, 'Tod, status?')],
      [3000, audio(true)],
      [4000, interim(OTHER.id, 'ha ha')],
    ]);
    assert.strictEqual(
      out.some(([, a]) => a.type === 'interrupt'),
      true
    );
  });
});
describe('split finals', () => {
  test('one question split across several finals: the brain ends up asked the whole thing, before Tod says a word', () => {
    const { asks, out } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What are you', false)],
      [1400, final(CALLER.id, 'working on', true)],
      [1700, started(CALLER.id)],
      [1900, final(CALLER.id, 'this morning?', true)],
    ]);
    assert.strictEqual(
      asks.at(-1)![1].text,
      'What are you working on this morning?'
    );
    assert.strictEqual(
      out.filter(([, a]) => a.type === 'interrupt').length,
      asks.length - 1
    );
    assert.strictEqual(
      out.some(([, a]) => a.type === 'stop_speaking'),
      false
    );
  });
  test('interim speech after a final holds the decision', () => {
    const { asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'So the thing is', true)],
      [1500, interim(CALLER.id, 'the database')],
      [2100, interim(CALLER.id, 'the database keeps')],
      [2600, final(CALLER.id, 'the database keeps dying.', true)],
    ]);
    assert.strictEqual(
      asks.at(-1)![1].text,
      'So the thing is the database keeps dying.'
    );
  });
  test('more from the asker while Tod is still thinking replaces the question with the whole thing', () => {
    const { out, asks } = run([
      [0, join(CALLER)],
      [1000, final(CALLER.id, 'What are you working on?')],
      [3500, final(CALLER.id, 'And is Slack done?')],
    ]);
    assert.strictEqual(
      out.some(([, a]) => a.type === 'interrupt'),
      true
    );
    assert.deepStrictEqual(
      asks.map(([, a]) => a.text),
      [
        'What are you working on?',
        'What are you working on? And is Slack done?',
      ]
    );
  });
});
describe('presence', () => {
  test('leaves 30s after the last human goes', () => {
    const { out } = run(
      [
        [0, join(CALLER)],
        [5000, { type: 'left', who: CALLER.id }],
      ],
      40000
    );
    const leave = out.find(([, a]) => a.type === 'leave');
    assert.strictEqual(leave?.[0], 35000);
  });
  test('someone rejoining cancels the leave', () => {
    const { out } = run(
      [
        [0, join(CALLER)],
        [5000, { type: 'left', who: CALLER.id }],
        [20000, join(CALLER)],
      ],
      60000
    );
    assert.strictEqual(
      out.some(([, a]) => a.type === 'leave'),
      false
    );
  });
  test('leaves if nobody ever shows up within 60s', () => {
    const { out } = run([], 70000);
    assert.strictEqual(out.find(([, a]) => a.type === 'leave')?.[0], 60000);
  });
});
