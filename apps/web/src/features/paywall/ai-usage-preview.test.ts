import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiUsagePreview } from './ai-usage-preview';

const state = vi.hoisted(() => ({ dev: true }));
vi.mock('@core/constant/featureFlags', () => ({
  get DEV_MODE_ENV() {
    return state.dev;
  },
}));

const snapshot: AiUsageSnapshot = {
  tier: 'premium',
  unlimited: false,
  payer: 'macro|payer@example.com',
  can_manage_billing: true,
  seats: 1,
  period_start: '2026-10-01T00:00:00Z',
  period_end: '2026-11-01T00:00:00Z',
  included_cents: 4_000,
  used_cents: 1_000,
  credits_consumed_cents: 500,
  credit_balance_cents: 2_500,
  overage_enabled: true,
  overage_limit_cents: 5_000,
  overage_charged_cents: 1_000,
  overage_suspended: false,
  uncovered_cents: 0,
  remaining_cents: 10_500,
};

beforeEach(() => {
  state.dev = true;
  useAiUsagePreview().reset();
});

describe('AI usage preview', () => {
  it('shares an exhausted preview across consumers without mutating the summary', () => {
    const before = { ...snapshot };
    useAiUsagePreview().previewLimit('paid');
    const preview = useAiUsagePreview().withPreview(snapshot);
    expect(preview).toMatchObject({
      used_cents: snapshot.included_cents,
      remaining_cents: 0,
      credit_balance_cents: 0,
      overage_enabled: false,
      blocked_reason: 'allowance_exhausted',
    });
    expect(snapshot).toEqual(before);
    useAiUsagePreview().reset();
    expect(useAiUsagePreview().withPreview(snapshot)).toBe(snapshot);
  });

  it('uses the backend allowance and Free refusal reason in the preview', () => {
    useAiUsagePreview().previewLimit('free');
    const preview = useAiUsagePreview().withPreview({
      ...snapshot,
      tier: 'free',
      included_cents: 500,
      used_cents: 250,
    });
    expect(preview).toMatchObject({
      tier: 'free',
      included_cents: 500,
      used_cents: 500,
      blocked_reason: 'free_allowance_exhausted',
    });
  });

  it('cannot override billing data outside development', () => {
    state.dev = false;
    useAiUsagePreview().previewLimit('paid');
    useAiUsagePreview().previewBeforeLaunch();
    expect(useAiUsagePreview().active()).toBe(false);
    expect(useAiUsagePreview().beforeLaunch()).toBe(false);
    expect(useAiUsagePreview().withPreview(snapshot)).toBe(snapshot);
  });

  it('previews the rollout announcement with real usage or either plan and resets it', () => {
    const preview = useAiUsagePreview();
    preview.previewBeforeLaunch();
    expect(preview.active()).toBe(true);
    expect(preview.beforeLaunch()).toBe(true);
    expect(preview.withPreview(snapshot)).toBe(snapshot);
    for (const plan of ['free', 'paid'] as const) {
      preview.previewPlan(plan);
      expect(preview.beforeLaunch()).toBe(true);
      expect(preview.withPreview(snapshot)?.tier).toBe(
        plan === 'free' ? 'free' : 'premium'
      );
    }
    preview.reset();
    expect(preview.active()).toBe(false);
    expect(preview.beforeLaunch()).toBe(false);
    expect(preview.withPreview(snapshot)).toBe(snapshot);
  });
});
