import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as feedDefinition from '../core/feed';
import { TEST_ITEMS } from '../tests/fixtures';
import { createFeedSource } from './feed-source';

const projection = vi.hoisted(() => ({
  options: [] as Array<() => { id: string; enabled?: boolean }>,
  refresh: vi.fn(),
  refetch: vi.fn(),
  generating: false,
  data: undefined as unknown,
  error: undefined as string | undefined,
}));
vi.mock('@core/component/AI/constant', () => ({
  FREE_DEFAULT_MODEL: 'test/model',
}));
vi.mock('@queries/ai/projection', () => ({
  createAIProjection: (options: () => { id: string; enabled?: boolean }) => {
    projection.options.push(options);
    return {
      data: () => projection.data,
      isGenerating: () => projection.generating,
      query: { isFetching: false, refetch: projection.refetch },
      error: () => projection.error,
      isForbidden: () => false,
      refresh: projection.refresh,
    };
  },
}));
beforeEach(() => {
  projection.refresh.mockReset();
  projection.refetch.mockReset();
  projection.generating = false;
  projection.options = [];
  projection.data = undefined;
  projection.error = undefined;
});

function mount(userId: string, prompt: string) {
  let source!: ReturnType<typeof createFeedSource>;
  let setPrompt!: (value: string) => void;
  const dispose = createRoot((cleanup) => {
    const [preference, update] = createSignal(prompt);
    setPrompt = update;
    source = createFeedSource(userId, preference);
    return cleanup;
  });
  return { source, setPrompt, dispose };
}

describe('live feed projection adapter', () => {
  it('isolates the projection by account and preferences and returns generated results', async () => {
    const first = mount('first-user', 'Build useful tools.');
    const second = mount('second-user', 'Build useful tools.');
    try {
      await vi.waitFor(() =>
        expect(projection.options.every((options) => options().enabled)).toBe(
          true
        )
      );
      const firstId = projection.options[0]!().id;
      const secondId = projection.options[1]!().id;
      expect(firstId).not.toBe(secondId);
      expect(firstId).not.toContain('first-user');
      first.setPrompt('Find missed work.');
      await vi.waitFor(() => {
        expect(projection.options[0]!().enabled).toBe(true);
        expect(projection.options[0]!().id).not.toBe(firstId);
      });
      projection.data = { items: TEST_ITEMS };
      expect(first.source.items()).toEqual(TEST_ITEMS);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
  it('isolates new prompt definitions from older open tabs for the same account', async () => {
    const oldTab = mount('same-user', 'Find useful work.');
    await vi.waitFor(() => expect(projection.options[0]!().enabled).toBe(true));
    const oldId = projection.options[0]!().id;
    const original = feedDefinition.buildFeedPrompt;
    const revisedPrompt = vi
      .spyOn(feedDefinition, 'buildFeedPrompt')
      .mockImplementation(
        (preference) =>
          `${original(preference)}\nLook for a new category of opportunities.`
      );
    const newTab = mount('same-user', 'Find useful work.');
    try {
      await vi.waitFor(() =>
        expect(projection.options[1]!().enabled).toBe(true)
      );
      expect(projection.options[1]!().id).not.toBe(oldId);
      expect(projection.options[0]!().id).toBe(oldId);
    } finally {
      oldTab.dispose();
      newTab.dispose();
      revisedPrompt.mockRestore();
    }
  });
  it('keeps refresh busy and prevents duplicate generation requests', async () => {
    const mounted = mount('refresh-user', 'Find useful work.');
    let finish!: () => void;
    projection.data = { items: TEST_ITEMS };
    projection.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    try {
      await vi.waitFor(() => expect(mounted.source.canRetry()).toBe(true));
      const pending = mounted.source.refresh();
      expect(mounted.source.refreshing()).toBe(true);
      expect(mounted.source.canRetry()).toBe(false);
      await mounted.source.refresh();
      expect(projection.refresh).toHaveBeenCalledTimes(1);
      finish();
      await pending;
      expect(mounted.source.refreshing()).toBe(false);
      expect(mounted.source.canRetry()).toBe(true);
    } finally {
      mounted.dispose();
    }
  });
  it('recovers completed materializations when realtime delivery is unavailable', async () => {
    projection.generating = true;
    projection.refetch.mockImplementation(async () => {
      projection.data = { items: TEST_ITEMS };
    });
    const mounted = mount('disconnected-user', 'Find useful work.');
    await vi.waitFor(() => expect(mounted.source.canRetry()).toBe(true));
    vi.useFakeTimers();
    // Start a fresh generation interval after the async projection key resolves.
    await mounted.source.refresh();
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(projection.refetch).toHaveBeenCalledTimes(1);
      expect(mounted.source.items()).toEqual(TEST_ITEMS);
      await vi.advanceTimersByTimeAsync(80_000);
      expect(mounted.source.error()).toBe('generation_timeout');
      expect(mounted.source.refreshing()).toBe(false);
      const callsAtTimeout = projection.refetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(projection.refetch).toHaveBeenCalledTimes(callsAtTimeout);
    } finally {
      mounted.dispose();
      vi.useRealTimers();
    }
  });
  it('surfaces generation errors without sample data', () => {
    const mounted = mount('error-user', 'Find useful work.');
    try {
      projection.error = 'generation unavailable';
      expect(mounted.source.error()).toBe('generation unavailable');
      expect(mounted.source.items()).toBeUndefined();
    } finally {
      mounted.dispose();
    }
  });
});
