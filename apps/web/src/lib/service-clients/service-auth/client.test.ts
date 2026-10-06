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

describe('credit checkout', () => {
  const args = {
    amountCents: 2_500,
    successUrl:
      'https://localhost:3000/app/settings/usage?aiCreditsSuccess=true',
    cancelUrl: 'https://localhost:3000/app/settings/usage?aiCreditsCancel=true',
  };

  test('sends the selected pack and return URLs and resolves to the hosted checkout URL', async () => {
    fetchCheckout.mockResolvedValueOnce(
      ok({ url: 'https://checkout.stripe.com/test' })
    );
    const result = await authServiceClient.createAiCreditCheckout(args);
    expect(result._unsafeUnwrap()).toBe('https://checkout.stripe.com/test');
    expect(fetchCheckout).toHaveBeenCalledWith(
      expect.stringMatching(/\/ai-billing\/credits\/checkout$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(args),
      })
    );
  });

  test.each([
    [402, 'PAID_PLAN_REQUIRED'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [500, 'SERVER_ERROR'],
  ])(
    'preserves a %i response as %s for the checkout view',
    async (status, code) => {
      fetchCheckout.mockImplementationOnce(
        async (
          _input: RequestInfo,
          init: FetchWithTokenInit<'PAID_PLAN_REQUIRED'>
        ) => {
          const error = await init.errorResponseHandler?.(
            new Response(JSON.stringify({ error: 'a paid plan is required' }), {
              status,
            })
          );
          if (!error) throw new Error('Expected a checkout error handler');
          return err([error]);
        }
      );
      const result = await authServiceClient.createAiCreditCheckout(args);
      expect(result._unsafeUnwrapErr()[0].code).toBe(code);
    }
  );
});
