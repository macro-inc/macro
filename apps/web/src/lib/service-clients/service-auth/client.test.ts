/**
 * @vitest-environment jsdom
 */

import type { FetchWithTokenInit } from '@core/util/fetchWithToken';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authServiceClient, getExpiresAt } from './client';

const { fetchCheckout } = vi.hoisted(() => ({ fetchCheckout: vi.fn() }));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: fetchCheckout }));
vi.mock('./fetch', () => ({ fetchWithAuth: fetchCheckout }));

beforeEach(() => fetchCheckout.mockReset());

function jwt(exp: unknown) {
  const payload = btoa(JSON.stringify({ exp }));
  return `header.${payload}.signature`;
}

describe('getExpiresAt', () => {
  test('converts a numeric exp from seconds to milliseconds', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;

    expect(getExpiresAt(jwt(exp))).toBe(exp * 1000);
  });

  test('rejects an array-valued exp', () => {
    const exp = [Math.floor(Date.now() / 1000) + 3600];

    expect(getExpiresAt(jwt(exp))).toBe(0);
  });
});

describe('passwordless code check', () => {
  test.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [400, 'HTTP_ERROR'],
    [500, 'SERVER_ERROR'],
  ])('reports a %i response as %s', async (status, code) => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response('rejected', { status }));
    const result = await authServiceClient.passwordlessCallback({
      code: '424242',
      email: 'member@acme.com',
    });
    expect(result._unsafeUnwrapErr()[0].code).toBe(code);
    fetch.mockRestore();
  });
});

describe('credit purchase', () => {
  test('sends the selected pack and resolves to the outcome and new position', async () => {
    const outcome = {
      status: 'paid',
      amountCents: 2_500,
      snapshot: { remaining_cents: 100 },
    };
    fetchCheckout.mockResolvedValueOnce(ok(outcome));
    const result = await authServiceClient.purchaseAiCredits({
      amountCents: 2_500,
    });
    expect(result._unsafeUnwrap()).toEqual(outcome);
    expect(fetchCheckout).toHaveBeenCalledWith(
      expect.stringMatching(/\/ai-billing\/credits\/purchase$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amountCents: 2_500 }),
      })
    );
  });

  test.each([
    [
      402,
      '{"error":"a paid plan is required"}',
      'PAID_PLAN_REQUIRED',
      'A paid plan is required',
    ],
    [
      409,
      '{"error":"this purchase would exceed the monthly credit limit"}',
      'CREDIT_PURCHASE_REJECTED',
      'this purchase would exceed the monthly credit limit',
    ],
    [409, 'not json', 'CREDIT_PURCHASE_REJECTED', 'Credit purchase rejected'],
    [
      500,
      '{"error":"internal error"}',
      'SERVER_ERROR',
      'Internal server error',
    ],
  ])(
    'reports a %i response for the purchase views',
    async (status, body, code, message) => {
      fetchCheckout.mockImplementationOnce(
        async (
          _input: RequestInfo,
          init: FetchWithTokenInit<
            'PAID_PLAN_REQUIRED' | 'CREDIT_PURCHASE_REJECTED'
          >
        ) => {
          const error = await init.errorResponseHandler?.(
            new Response(body, { status })
          );
          if (!error) throw new Error('Expected a purchase error handler');
          return err([error]);
        }
      );
      const result = await authServiceClient.purchaseAiCredits({
        amountCents: 2_500,
      });
      expect(result._unsafeUnwrapErr()[0]).toEqual({ code, message });
    }
  );
});

describe('subscription checkout conflicts', () => {
  test.each([
    ['The 30-day trial is only available for your first Premium subscription'],
    ['User already has an active subscription'],
  ])('preserves the actionable server explanation: %s', async (message) => {
    fetchCheckout.mockImplementationOnce(
      async (_input: RequestInfo, init: FetchWithTokenInit) => {
        const error = await init.errorResponseHandler?.(
          new Response(JSON.stringify({ message }), { status: 409 })
        );
        if (!error) throw new Error('Expected a checkout error handler');
        return err([error]);
      }
    );
    const result = await authServiceClient.createCheckoutSessionV2({
      plan: 'premium',
      onboardingTrial: true,
      successUrl: 'https://macro.com/app',
      cancelUrl: 'https://macro.com/app',
    });
    expect(result._unsafeUnwrapErr()[0]).toEqual({ code: 'CONFLICT', message });
  });
});

describe('GitHub reconnect', () => {
  test('starts OAuth without deleting the current link', async () => {
    fetchCheckout.mockResolvedValueOnce(
      ok({ url: 'https://github.com/login/oauth/authorize' })
    );
    const result =
      await authServiceClient.reauthenticateGithub('tauri://localhost');
    expect(result.isOk()).toBe(true);
    expect(fetchCheckout).toHaveBeenCalledTimes(1);
    expect(fetchCheckout).toHaveBeenCalledWith(
      expect.stringContaining('/link/github'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('GitHub outages', () => {
  function answerWith(status: number, body: string) {
    fetchCheckout.mockImplementationOnce(
      async (_input: RequestInfo, init: FetchWithTokenInit) => {
        const error = await init.errorResponseHandler?.(
          new Response(body, { status })
        );
        if (!error) throw new Error('Expected a GitHub error handler');
        return err([error]);
      }
    );
  }
  const upstream = (message: string) =>
    JSON.stringify({ message, code: 'upstream_rate_limited' });
  const pullRequest = { owner: 'acme', repo: 'app', number: 7 };

  test.each([
    [503, 'GitHub is limiting requests right now. Try again shortly.'],
    [
      502,
      'GitHub returned an unexpected response. Try again in a few minutes.',
    ],
  ])(
    'shows the %i explanation when a merge fails upstream',
    async (status, message) => {
      answerWith(status, upstream(message));
      const result =
        await authServiceClient.mergeGithubPullRequest(pullRequest);
      expect(result._unsafeUnwrapErr()[0]).toEqual({
        code: 'HTTP_ERROR',
        message,
      });
    }
  );

  test('shows the explanation when a state change or link check fails upstream', async () => {
    const message =
      'The sign-in service is temporarily unavailable. Try again in a few minutes.';
    answerWith(503, upstream(message));
    const state = await authServiceClient.setGithubPullRequestState({
      ...pullRequest,
      state: 'closed',
    });
    expect(state._unsafeUnwrapErr()[0]).toEqual({
      code: 'HTTP_ERROR',
      message,
    });

    answerWith(503, upstream(message));
    const link = await authServiceClient.checkGithubLinkStatus();
    expect(link._unsafeUnwrapErr()[0]).toEqual({ code: 'HTTP_ERROR', message });
  });

  test('falls back to the status for an unreadable outage body and keeps 500s', async () => {
    answerWith(503, '<html>maintenance</html>');
    const outage = await authServiceClient.mergeGithubPullRequest(pullRequest);
    expect(outage._unsafeUnwrapErr()[0]).toEqual({
      code: 'HTTP_ERROR',
      message: 'HTTP error! status: 503',
    });

    answerWith(500, JSON.stringify({ message: 'internal error' }));
    const bug = await authServiceClient.mergeGithubPullRequest(pullRequest);
    expect(bug._unsafeUnwrapErr()[0]).toEqual({
      code: 'SERVER_ERROR',
      message: 'Internal server error',
    });
  });
});
