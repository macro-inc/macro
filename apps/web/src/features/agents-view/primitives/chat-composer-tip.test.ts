import { cleanup, renderHook } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatComposerTip } from './chat-composer-tip';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Chat composer tips', () => {
  it('omits the agent-selection tip inside a session', () => {
    const { result: tip } = renderHook(() =>
      createChatComposerTip(() => true, false)
    );
    const first = tip();
    vi.advanceTimersByTime(6000);
    expect(tip()).toContain('skill');
    vi.advanceTimersByTime(6000);
    expect(tip()).toContain('@');
    vi.advanceTimersByTime(6000);
    expect(tip()).toBe(first);
  });

  it('cycles through connectors, skills, mentions and agents, then repeats', () => {
    const { result: tip } = renderHook(() => createChatComposerTip(() => true));
    const first = tip();
    expect(first).toContain('Connections');
    vi.advanceTimersByTime(6000);
    expect(tip()).toContain('skill');
    vi.advanceTimersByTime(6000);
    expect(tip()).toContain('@');
    vi.advanceTimersByTime(6000);
    expect(tip()).toContain('agent');
    vi.advanceTimersByTime(6000);
    expect(tip()).toBe(first);
  });

  it('pauses while writing and resumes when the draft is cleared', () => {
    const [empty, setEmpty] = createSignal(true);
    const { result: tip } = renderHook(() => createChatComposerTip(empty));
    const first = tip();
    setEmpty(false);
    vi.advanceTimersByTime(18000);
    expect(tip()).toBe(first);
    setEmpty(true);
    vi.advanceTimersByTime(6000);
    expect(tip()).toContain('skill');
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
