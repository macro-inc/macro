import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchWithToken = vi.hoisted(() => vi.fn());
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));

import { computerClaudeClient } from './computer-claude';

afterEach(() => {
  fetchWithToken.mockReset();
});

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('computer Claude errors', () => {
  it('tells the rollout refusal apart from a missing right on sign-in and sign-out', async () => {
    fetchWithToken.mockResolvedValue(ok({}));
    await computerClaudeClient.startSignIn(
      'harness-1',
      new AbortController().signal
    );
    await computerClaudeClient.signOut('harness-1');
    for (const [, init] of fetchWithToken.mock.calls) {
      const handler = init.errorResponseHandler;
      expect(
        (await handler(response(403, { code: 'rollout_disabled' }))).code
      ).toBe('ROLLOUT_DISABLED');
      expect((await handler(response(403, { message: 'no' }))).code).toBe(
        'FORBIDDEN'
      );
      expect((await handler(response(403, { code: 'future_code' }))).code).toBe(
        'FORBIDDEN'
      );
    }
  });
});
