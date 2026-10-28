import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SuggestionObservation } from '../context/telemetry';
import { type Intent, intents, type Scores } from '../core/input';
import {
  createIntentSuggestion,
  type IntentSuggestionSource,
} from './intent-suggestion';

function scored(top: Intent, score = 0.9): Scores {
  return intents.map((intent) => ({
    intent,
    score: intent === top ? score : 0.05,
  }));
}

const cleanups: (() => void)[] = [];
function mount(
  text: () => string,
  overrides: Partial<IntentSuggestionSource> = {}
) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    return createIntentSuggestion(text, {
      classify: vi.fn(async (_text, revision) => ({
        revision,
        scores: scored('task'),
      })),
      offers: () => ['task', 'calendar', 'email', 'note'],
      ...overrides,
    });
  });
}
/** Past the settle delay, then the resolved classification. */
const settle = () => vi.advanceTimersByTimeAsync(700);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

it('offers the recognized type once typing settles', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text);
  setText('remind me to send the deck tomorrow');
  expect(state.intent()).toBeUndefined();
  await settle();
  expect(state.intent()).toBe('task');
});

it('stays quiet while the draft is too short to read, and classifies nothing', async () => {
  const classify = vi.fn(async (_text: string, revision: number) => ({
    revision,
    scores: scored('task'),
  }));
  const [text, setText] = createSignal('');
  const state = mount(text, { classify });
  setText('on it');
  await settle();
  expect(classify).not.toHaveBeenCalled();
  expect(state.intent()).toBeUndefined();
});

it('stays quiet when the host already does what the draft asks for', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text, {
    classify: async (_text, revision) => ({
      revision,
      scores: scored('message'),
    }),
  });
  setText('tell the team the deck is ready');
  await settle();
  expect(state.intent()).toBeUndefined();
});

it('stays quiet when the recognized type is only a guess', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text, {
    classify: async (_text, revision) => ({
      revision,
      scores: scored('task', 0.42),
    }),
  });
  setText('remind me to send the deck tomorrow');
  await settle();
  expect(state.intent()).toBeUndefined();
});

it('keeps the offer while the draft grows and replaces it with a later reading', async () => {
  const [text, setText] = createSignal('');
  let top: Intent = 'task';
  const state = mount(text, {
    classify: async (_text, revision) => ({ revision, scores: scored(top) }),
  });
  setText('remind me to send the deck tomorrow');
  await settle();
  expect(state.intent()).toBe('task');
  top = 'calendar';
  setText('remind me to send the deck tomorrow at 3pm');
  expect(state.intent()).toBe('task');
  await settle();
  expect(state.intent()).toBe('calendar');
});

it('discards a reading of text the writer has already replaced', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text, {
    classify: async (draft, revision) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        revision,
        scores: scored(draft.includes('3pm') ? 'calendar' : 'task'),
      };
    },
  });
  setText('remind me to send the deck tomorrow');
  await vi.advanceTimersByTimeAsync(620);
  setText('lunch with the team on friday at 3pm');
  await vi.advanceTimersByTimeAsync(60);
  expect(state.intent()).toBeUndefined();
  await settle();
  expect(state.intent()).toBe('calendar');
});

it('offers nothing more after a refusal, until the draft is cleared', async () => {
  const classify = vi.fn(async (_text: string, revision: number) => ({
    revision,
    scores: scored('task'),
  }));
  const [text, setText] = createSignal('');
  const state = mount(text, { classify });
  setText('remind me to send the deck tomorrow');
  await settle();
  state.dismiss();
  expect(state.intent()).toBeUndefined();

  setText('remind me to send the deck tomorrow afternoon');
  await settle();
  expect(state.intent()).toBeUndefined();
  expect(classify).toHaveBeenCalledTimes(1);

  setText('');
  setText('book a review of the deck with the team');
  await settle();
  expect(state.intent()).toBe('task');
});

it('stops reading the draft once a composer takes it', async () => {
  const classify = vi.fn(async (_text: string, revision: number) => ({
    revision,
    scores: scored('task'),
  }));
  const [text, setText] = createSignal('');
  const state = mount(text, { classify });
  setText('remind me to send the deck tomorrow');
  await settle();
  state.accept();
  setText('remind me to send the deck tomorrow afternoon');
  await settle();
  expect(classify).toHaveBeenCalledTimes(1);
  expect(state.intent()).toBeUndefined();
});

it('reads nothing while the host has no use for an offer', async () => {
  const classify = vi.fn(async (_text: string, revision: number) => ({
    revision,
    scores: scored('task'),
  }));
  const [text, setText] = createSignal('');
  const [enabled, setEnabled] = createSignal(false);
  const state = mount(text, { classify, enabled });
  setText('remind me to send the deck tomorrow');
  await settle();
  expect(classify).not.toHaveBeenCalled();
  setEnabled(true);
  await settle();
  expect(state.intent()).toBe('task');
});

it('records what became of each offer', async () => {
  const observations: SuggestionObservation[] = [];
  const [text, setText] = createSignal('');
  const state = mount(text, {
    observe: (observation) => observations.push(observation),
  });
  setText('remind me to send the deck tomorrow');
  await settle();
  state.accept();
  expect(observations).toEqual([
    { event: 'offered', intent: 'task', score: 0.9 },
    { event: 'retired', intent: 'task', outcome: 'accepted' },
  ]);
});

it('says nothing when inference is unavailable', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text, {
    classify: async () => {
      throw new Error('offline');
    },
  });
  setText('remind me to send the deck tomorrow');
  await settle();
  expect(state.intent()).toBeUndefined();
});
