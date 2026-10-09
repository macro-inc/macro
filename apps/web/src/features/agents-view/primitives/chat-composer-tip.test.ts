import { cleanup, renderHook } from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatComposerTip } from './chat-composer-tip';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Follow timer-driven text until a complete hint is visible. */
function readHint(tip: Accessor<string>, expected: string) {
  for (let step = 0; step < 300 && tip() !== expected; step++)
    vi.advanceTimersToNextTimer();
  expect(tip()).toBe(expected);
}

const CONNECT = 'Connect your apps in Agents → Connections';

describe('Chat composer tips', () => {
  it('types progressively, pauses, quickly erases and types the next hint', () => {
    const { result: tip } = renderHook(() => createChatComposerTip(() => true));
    expect(tip()).toBe('');
    vi.advanceTimersToNextTimer();
    expect(tip()).toBe('C');
    const typedAt = Date.now();
    vi.advanceTimersToNextTimer();
    expect(tip()).toBe('Co');
    const typingTime = Date.now() - typedAt;
    readHint(tip, CONNECT);
    vi.advanceTimersByTime(2000);
    expect(tip()).toBe(CONNECT);
    vi.advanceTimersToNextTimer();
    expect(CONNECT.startsWith(tip())).toBe(true);
    expect(tip().length).toBeLessThan(CONNECT.length);
    const deletingAt = Date.now();
    vi.advanceTimersToNextTimer();
    expect(Date.now() - deletingAt).toBeLessThan(typingTime);
    readHint(tip, '');
    vi.advanceTimersToNextTimer();
    expect(tip()).toBe('T');
    readHint(tip, 'Type / to add a skill');
  });

  it('cycles through connectors, skills, mentions and agents, then repeats', () => {
    const { result: tip } = renderHook(() => createChatComposerTip(() => true));
    for (const hint of [
      CONNECT,
      'Type / to add a skill',
      'Type @ to mention docs, people, or channels',
      'Choose an agent to change who helps',
      CONNECT,
    ])
      readHint(tip, hint);
  });

  it('omits the agent-selection tip inside a session', () => {
    const { result: tip } = renderHook(() =>
      createChatComposerTip(() => true, false)
    );
    for (const hint of [
      CONNECT,
      'Use @ to reference a skill document',
      'Type @ to mention docs, people, or channels',
      CONNECT,
    ])
      readHint(tip, hint);
  });

  it('stops while writing and resumes the same hint when the draft is cleared', () => {
    const [empty, setEmpty] = createSignal(true);
    const { result: tip } = renderHook(() => createChatComposerTip(empty));
    vi.advanceTimersToNextTimer();
    expect(tip()).toBe('C');
    setEmpty(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(18000);
    expect(tip()).toBe('C');
    setEmpty(true);
    vi.advanceTimersToNextTimer();
    expect(tip()).toBe('Co');
  });

  it('stops its timer when the composer is removed', () => {
    const { cleanup: dispose } = renderHook(() =>
      createChatComposerTip(() => true)
    );
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
