import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { intents, type Scores } from '../../../universal-input/core/input';
import { createComposerIntent } from '../create-composer-intent';

const classify = vi.fn(
  async (
    _text: string,
    revision: number
  ): Promise<{
    revision: number;
    scores: Scores;
  }> => ({
    revision,
    scores: intents.map((intent) => ({
      intent,
      score: intent === 'task' ? 0.93 : 0.04,
    })),
  })
);

// Only the network boundary is replaced; the offer and its lifecycle are real.
vi.mock('../../../universal-input/inference', () => ({
  createInferenceSource: () => ({
    classify: (text: string, revision: number) => classify(text, revision),
    extract: vi.fn(),
    dispose: vi.fn(),
  }),
}));

const cleanups: (() => void)[] = [];
function mount(text: () => string) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    return createComposerIntent({ text, enabled: () => true });
  });
}
/** Past the offer's settle delay, then its resolved classification. */
const settle = () => vi.advanceTimersByTimeAsync(700);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('keeps the submit chord while the form is still loading, so the draft is never sent instead', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text);
  setText('remind me to send the investor deck tomorrow');
  await settle();
  expect(state.open()).toBe(true);

  // The form is lazily loaded, so it has not reported its controls yet.
  expect(state.submit()).toBe(true);

  const submit = vi.fn(async () => {});
  state.captureControls({ submit, ready: () => true });
  expect(state.submit()).toBe(true);
  expect(submit).toHaveBeenCalledOnce();
});

it('leaves the submit chord to the composer while no form is open', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text);
  setText('remind me to send the investor deck tomorrow');
  await settle();
  expect(state.submit()).toBe(false);

  state.open();
  state.close();
  expect(state.submit()).toBe(false);
});

it('closes the form once the draft it was reading is gone', async () => {
  const [text, setText] = createSignal('');
  const state = mount(text);
  setText('remind me to send the investor deck tomorrow');
  await settle();
  state.open();
  expect(state.accepted()).toBe('task');

  setText('');
  expect(state.isOpen()).toBe(false);
  expect(state.submit()).toBe(false);
});
