import { FreeTierModel } from '@service-cognition/generated/schemas/freeTierModel';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHomeRecommendations } from '../createHomeRecommendations';
import type { HomeRecommendations } from '../homeRecommendations';
import { createAIProjection } from '../projection';

const plan = vi.hoisted(() => ({ premium: true }));

vi.mock('@core/context/user', () => ({
  useHasPermission: () => () => plan.premium,
}));
vi.mock('../projection', () => ({ createAIProjection: vi.fn() }));

afterEach(() => {
  plan.premium = true;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Home recommendation loading', () => {
  it('keeps the original timeout when projection updates leave it waiting', async () => {
    vi.useFakeTimers();
    const [status, setStatus] = createSignal<'cold' | 'loading' | 'refreshing'>(
      'cold'
    );
    vi.mocked(createAIProjection).mockReturnValue({
      data: () => undefined,
      isGenerating: () => ['cold', 'loading', 'refreshing'].includes(status()),
      error: () => undefined,
      isForbidden: () => false,
      refresh: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof createAIProjection>);

    let dispose!: () => void;
    const recommendations = createRoot((cleanup) => {
      dispose = cleanup;
      return createHomeRecommendations();
    });
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      setStatus('loading');
      await vi.advanceTimersByTimeAsync(15_000);
      setStatus('refreshing');
      await vi.advanceTimersByTimeAsync(14_999);
      expect(recommendations.isLoading()).toBe(true);
      expect(recommendations.hasError()).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(recommendations.isLoading()).toBe(false);
      expect(recommendations.hasError()).toBe(true);

      setStatus('loading');
      expect(recommendations.isLoading()).toBe(false);
      expect(recommendations.hasError()).toBe(true);
    } finally {
      dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a stalled shimmer, allows retry, and accepts a late result', async () => {
    vi.useFakeTimers();
    const [data, setData] = createSignal<HomeRecommendations>();
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createAIProjection).mockReturnValue({
      data,
      isGenerating: () => true,
      error: () => undefined,
      isForbidden: () => false,
      refresh,
    } as unknown as ReturnType<typeof createAIProjection>);

    let dispose!: () => void;
    const recommendations = createRoot((cleanup) => {
      dispose = cleanup;
      return createHomeRecommendations();
    });
    try {
      expect(recommendations.isLoading()).toBe(true);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(recommendations.isLoading()).toBe(false);
      expect(recommendations.hasError()).toBe(true);

      await recommendations.retry();
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(recommendations.isLoading()).toBe(true);
      expect(recommendations.hasError()).toBe(false);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(recommendations.hasError()).toBe(true);

      setData({
        items: [
          {
            entityType: 'email_thread',
            entityId: 'thread-1',
            title: 'Review',
            source: 'Email',
            action: 'review',
            reason: 'Needs review',
            prompt: 'Review this email',
          },
        ],
      });
      expect(recommendations.items()).toHaveLength(1);
      expect(recommendations.isLoading()).toBe(false);
      expect(recommendations.hasError()).toBe(false);
    } finally {
      dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Home recommendation entitlement', () => {
  it('requests only backend free-tier models for a free user', () => {
    plan.premium = false;
    vi.mocked(createAIProjection).mockReturnValue({
      data: () => undefined,
      isGenerating: () => true,
      error: () => undefined,
      isForbidden: () => false,
      refresh: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof createAIProjection>);

    createRoot((dispose) => {
      createHomeRecommendations();
      dispose();
    });

    const requests = vi
      .mocked(createAIProjection)
      .mock.calls.map(([options]) => options())
      .filter((options) => options.enabled);
    expect(requests.map((options) => options.id)).toEqual([
      'home/recommended-fast',
    ]);
    expect(Object.values(FreeTierModel)).toContain(requests[0].model);
  });

  it('does not offer or send a retry the plan refused', async () => {
    plan.premium = false;
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createAIProjection).mockReturnValue({
      data: () => undefined,
      isGenerating: () => false,
      error: () => 'Forbidden',
      isForbidden: () => true,
      refresh,
    } as unknown as ReturnType<typeof createAIProjection>);

    let dispose!: () => void;
    const recommendations = createRoot((cleanup) => {
      dispose = cleanup;
      return createHomeRecommendations();
    });
    try {
      expect(recommendations.hasError()).toBe(true);
      expect(recommendations.canRetry()).toBe(false);
      await recommendations.retry();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
