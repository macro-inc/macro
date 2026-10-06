import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { err, ok } from 'neverthrow';
import { afterEach, expect, test, vi } from 'vitest';
import { issueSessionAction } from './issue-session-action';

const state = useAiUsageLimitState();
afterEach(() => state.hideUsageLimit());

test.each([
  'ai_allowance_exhausted',
  'ai_free_allowance_exhausted',
  'ai_overage_limit_reached',
  'ai_overage_payment_failed',
] as const)(
  'presents a refused live session action (%s) without losing its result',
  async (reason) => {
    const refusal = err([
      { code: 'AI_USAGE_LIMIT' as const, reason, message: 'Usage blocked' },
    ]);
    const session = { issue: vi.fn().mockResolvedValue(refusal) };
    const action = { type: 'prompt', prompt: 'Hello' } as const;

    expect(await issueSessionAction(session, action)).toBe(refusal);
    expect(session.issue).toHaveBeenCalledWith(action);
    expect(state.usageLimitOpen()).toBe(true);
    expect(state.usageLimitCode()).toBe(reason);
  }
);

test('leaves permission failures and accepted actions to their caller', async () => {
  const failure = err([{ code: 'FORBIDDEN' as const, message: 'No access' }]);
  const accepted = ok({ actionId: 'action', status: 'sent' as const });
  const session = {
    issue: vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(accepted),
  };
  const action = { type: 'prompt', prompt: 'Hello' } as const;

  expect(await issueSessionAction(session, action)).toBe(failure);
  expect(await issueSessionAction(session, action)).toBe(accepted);
  expect(state.usageLimitOpen()).toBe(false);
});
