/** @vitest-environment jsdom */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReplyEligibility } from '../core/conversation';
import { createReplyEligibility } from './reply-eligibility';

afterEach(() => vi.useRealTimers());
it('expires using elapsed server time despite browser clock changes and accepts only new server permission', () => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
  const serverTime = Date.parse('2026-10-14T20:00:00Z');
  const { allowed, setDecision, dispose } = createRoot((dispose) => {
    const [decision, setDecision] = createSignal<ReplyEligibility>({
      evaluated_at: new Date(serverTime).toISOString(),
      modes: [
        {
          mode: 'free_form',
          allowed: true,
          expires_at: new Date(serverTime + 500).toISOString(),
        },
      ],
    });
    const allowed = createReplyEligibility(decision);
    return { allowed, setDecision, dispose };
  });
  expect(allowed('free_form')).toBe(true);
  vi.setSystemTime(new Date('1990-01-01T00:00:00Z'));
  vi.advanceTimersByTime(500);
  expect(allowed('free_form')).toBe(false);
  setDecision({
    evaluated_at: new Date(serverTime + 2000).toISOString(),
    modes: [{ mode: 'free_form', allowed: false, reason: 'forbidden' }],
  });
  expect(allowed('free_form')).toBe(false);
  setDecision({
    evaluated_at: new Date(serverTime + 3000).toISOString(),
    modes: [{ mode: 'free_form', allowed: true }],
  });
  expect(allowed('free_form')).toBe(true);
  expect(allowed('human_support')).toBe(false);
  setDecision({
    evaluated_at: 'invalid',
    modes: [{ mode: 'free_form', allowed: true }],
  });
  expect(allowed('free_form')).toBe(false);
  dispose();
});
