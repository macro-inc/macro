import { cleanup, render } from '@solidjs/testing-library';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTypewriter, Typewriter } from './Typewriter';

const timing = { typeMs: 10, deleteMs: 2, holdMs: 100, restMs: 20 };

/** Typing delays jitter, so step the clock until a condition holds. */
function advanceUntil(condition: () => boolean, maxMs = 5_000) {
  for (let elapsed = 0; elapsed < maxMs; elapsed++) {
    if (condition()) return elapsed;
    vi.advanceTimersByTime(1);
  }
  throw new Error('condition not met in time');
}

function mount(
  lines: Accessor<readonly string[]>,
  animate = true
): ReturnType<typeof createTypewriter> & { dispose: () => void } {
  return createRoot((dispose) => ({
    ...createTypewriter(lines, { ...timing, animate: () => animate }),
    dispose,
  }));
}

describe('createTypewriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('types each line, holds it, deletes it quickly, then types the next', () => {
    const { text, phase, dispose } = mount(() => ['Hi there', 'Bye']);
    expect(text()).toBe('');
    vi.advanceTimersByTime(timing.restMs);
    expect(text()).toBe('H');
    const typed = advanceUntil(() => text() === 'Hi there');
    // Typing runs at most 25% slower than typeMs and never faster than 75%.
    expect(typed).toBeGreaterThanOrEqual(7 * timing.typeMs * 0.75 - 1);
    expect(typed).toBeLessThanOrEqual(7 * timing.typeMs * 1.25 + 1);
    advanceUntil(() => phase() === 'holding');
    // Typing delays are fractional, so later phases land within 1ms.
    const held = advanceUntil(() => phase() === 'deleting');
    expect(Math.abs(held - timing.holdMs)).toBeLessThanOrEqual(1);
    const deleted = advanceUntil(() => text() === '');
    expect(
      Math.abs(deleted - 'Hi there'.length * timing.deleteMs)
    ).toBeLessThanOrEqual(1);
    advanceUntil(() => phase() === 'resting');
    expect(text()).toBe('');
    advanceUntil(() => text() === 'Bye');
    // Loops back around to the first line.
    advanceUntil(() => text() === '' && phase() === 'resting');
    advanceUntil(() => text() === 'Hi there');
    dispose();
  });

  it('leaves a single line in place once typed', () => {
    const { text, phase, dispose } = mount(() => ['Only one']);
    advanceUntil(() => text() === 'Only one');
    vi.advanceTimersByTime(timing.holdMs * 5);
    expect(text()).toBe('Only one');
    expect(phase()).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('shows the first line statically when motion is off', () => {
    const { text, phase, dispose } = mount(() => ['Still', 'Moving'], false);
    expect(text()).toBe('Still');
    expect(phase()).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('deletes the current line and restarts when the lines change', () => {
    const [lines, setLines] = createSignal<readonly string[]>([
      'Chat first',
      'Chat second',
    ]);
    const { text, phase, dispose } = mount(lines);
    advanceUntil(() => text() === 'Chat first' && phase() === 'holding');
    setLines(['Code first', 'Code second']);
    expect(phase()).toBe('deleting');
    const deleted = advanceUntil(() => text() === '');
    expect(
      Math.abs(deleted - 'Chat first'.length * timing.deleteMs)
    ).toBeLessThanOrEqual(1);
    advanceUntil(() => text() === 'Code first');
    advanceUntil(() => text() === 'Code second');
    dispose();
  });

  it('stops its timers when disposed', () => {
    const { dispose } = mount(() => ['A', 'B']);
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Typewriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('gives the heading a stable name while the visible text animates', () => {
    render(() => (
      <h2>
        <Typewriter
          phrases={['What should we build?', 'What should we ship?']}
          animate={() => true}
          {...timing}
        />
      </h2>
    ));
    const heading = document.querySelector('h2');
    expect(heading?.querySelector('.sr-only')?.textContent).toBe(
      'What should we build?'
    );
    const visible = heading?.querySelector('[data-typewriter-text]');
    expect(visible?.getAttribute('aria-hidden')).toBe('true');
    expect(visible?.textContent).toBe('\u200b');
    advanceUntil(() => visible?.textContent === 'What should we build?');
    expect(heading?.querySelector('.sr-only')?.textContent).toBe(
      'What should we build?'
    );
    expect(heading?.querySelector('[data-typewriter-caret]')).toBeTruthy();
    advanceUntil(() => visible?.textContent === 'What should we ship?');
  });

  it('hides the caret once a lone line is finished', () => {
    render(() => (
      <Typewriter phrases={['Done']} animate={() => true} {...timing} />
    ));
    expect(document.querySelector('[data-typewriter-caret]')).toBeTruthy();
    advanceUntil(
      () =>
        document
          .querySelector('[data-typewriter-text]')
          ?.getAttribute('data-phase') === 'done'
    );
    expect(document.querySelector('[data-typewriter-caret]')).toBeNull();
  });
});
