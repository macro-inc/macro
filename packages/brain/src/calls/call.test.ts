import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsyncQueue } from '../channel.ts';
import type { Brain } from './brain.ts';
import { Call, type Speaker, type TtsFactory } from './call.ts';
import type { TtsHandlers } from './tts.ts';

test('streams sentences, rejects stale audio after barge-in, and finishes the replacement turn', async () => {
  const firstAudio = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  const input = new Map<number, AsyncQueue<string>>();
  const spoken: string[] = [];
  let interrupts = 0;
  let clears = 0;
  let played = 0;
  let handlers: TtsHandlers | undefined;
  const brain: Brain = {
    async start() {},
    async *ask(turn) {
      const queue = new AsyncQueue<string>();
      input.set(turn, queue);
      yield turn === 1 ? 'One sentence.' : 'The database is fine.';
      yield* queue;
    },
    interrupt() {
      interrupts++;
      for (const queue of input.values()) queue.close();
    },
    async close() {},
  };
  const tts: TtsFactory = (callbacks) => {
    handlers = callbacks;
    return {
      speak(text, turn) {
        spoken.push(text);
        callbacks.onAudio(new Int16Array(240), turn);
      },
      flush(turn) {
        callbacks.onDone(turn);
      },
      clear() {
        clears++;
      },
      close() {},
    };
  };
  const speaker: Speaker = {
    play() {
      played++;
      firstAudio.resolve();
    },
    clear() {},
    duck() {},
    async drained() {},
  };
  const call = new Call(
    brain,
    tts,
    speaker,
    (type, data) => {
      if (type === 'turn.completed' && data?.turn === 2) completed.resolve();
    },
    () => 0,
    { names: ['Agent'] }
  );
  call.joined('caller', 'Caller');
  call.heard('caller', {
    kind: 'final',
    text: 'Tell me everything.',
    speechFinal: true,
  });
  call.heard('caller', { kind: 'utterance_end' });
  await firstAudio.promise;
  call.heard('caller', { kind: 'interim', text: 'Stop, just' });
  const before = played;
  handlers?.onAudio(new Int16Array(240), 1);
  assert.equal(played, before);
  assert.equal(interrupts, 1);
  assert(clears > 0);
  call.heard('caller', {
    kind: 'final',
    text: 'Stop, just the database.',
    speechFinal: true,
  });
  call.heard('caller', { kind: 'utterance_end' });
  // The generator registers its input before yielding, so it is available now.
  input.get(2)?.close();
  await completed.promise;
  assert.deepEqual(spoken, ['One sentence.', 'The database is fine.']);
  assert.equal(call.turns.state, 'idle');
  call.stop();
});
