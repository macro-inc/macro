import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchWithToken = vi.hoisted(() => vi.fn());
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));

import { computersClient, REQUEST_TIMEOUT_MS } from './computers';

afterEach(() => {
  vi.useRealTimers();
  fetchWithToken.mockReset();
});

/** The offers request's error handler, as the client hands it to fetch. */
async function offersHandler() {
  fetchWithToken.mockResolvedValue(ok([]));
  await computersClient.offers();
  return fetchWithToken.mock.calls[0][1].errorResponseHandler;
}

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('offers errors', () => {
  it('reads a 503 as computers being unavailable', async () => {
    const handler = await offersHandler();
    expect(
      await handler(response(503, { message: 'computers are not available' }))
    ).toEqual({
      code: 'COMPUTERS_UNAVAILABLE',
      message: "Computers aren't available right now. Try again later.",
    });
  });

  it('reads a 422 as the team having no paid plan', async () => {
    const handler = await offersHandler();
    expect(
      (await handler(response(422, { message: 'no active subscription' }))).code
    ).toBe('NO_PAID_PLAN');
  });

  it('tells a trialing team apart from one outside the rollout by the 403 code', async () => {
    const handler = await offersHandler();
    expect(
      (
        await handler(
          response(403, { message: 'on a trial', code: 'team_on_trial' })
        )
      ).code
    ).toBe('TEAM_ON_TRIAL');
    expect(
      (await handler(response(403, { message: 'not enabled' }))).code
    ).toBe('ROLLOUT_DISABLED');
  });

  it('reads a 502 as the billing provider failing, and any other 5xx as a server error', async () => {
    const handler = await offersHandler();
    expect((await handler(response(502, { message: 'stripe' }))).code).toBe(
      'BILLING_PROVIDER_FAILED'
    );
    expect((await handler(response(500, { message: 'internal' }))).code).toBe(
      'SERVER_ERROR'
    );
    expect((await handler(response(504, {}))).code).toBe('SERVER_ERROR');
  });

  it('leaves other client errors to the shared status mapping', async () => {
    const handler = await offersHandler();
    expect((await handler(response(404, {}))).code).toBe('NOT_FOUND');
  });
});

describe('purchase errors', () => {
  it('keeps its own 422 wording and shares the trial, rollout and provider refusals', async () => {
    fetchWithToken.mockResolvedValue(ok({}));
    await computersClient.purchase({ purchaseKey: 'key', size: 'standard' });
    const handler = fetchWithToken.mock.calls[0][1].errorResponseHandler;

    expect((await handler(response(422, {}))).code).toBe('NOT_PURCHASABLE');
    expect((await handler(response(502, {}))).code).toBe(
      'BILLING_PROVIDER_FAILED'
    );
    expect((await handler(response(403, {}))).code).toBe('ROLLOUT_DISABLED');
    expect((await handler(response(403, { code: 'team_on_trial' }))).code).toBe(
      'TEAM_ON_TRIAL'
    );
  });

  it('tells a team still paying for its last computer apart from other conflicts by the 409 code', async () => {
    fetchWithToken.mockResolvedValue(ok({}));
    await computersClient.purchase({ purchaseKey: 'key', size: 'standard' });
    const handler = fetchWithToken.mock.calls[0][1].errorResponseHandler;

    expect(
      (await handler(response(409, { code: 'unpaid_computer' }))).code
    ).toBe('UNPAID_COMPUTER');
    expect((await handler(response(409, { message: 'sold out' }))).code).toBe(
      'PURCHASE_CONFLICT'
    );
  });
});

describe('deadline', () => {
  it('gives every request a signal and names an abort after the deadline as a timeout', async () => {
    vi.useFakeTimers();
    fetchWithToken.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          init.signal.addEventListener('abort', () =>
            resolve(err([{ code: 'UNKNOWN_ERROR', message: 'aborted' }]))
          );
        })
    );

    const pending = computersClient.offers();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const result = await pending;

    expect(result.isErr() && result.error[0]?.code).toBe('TIMED_OUT');
  });

  it('passes other failures through untouched', async () => {
    fetchWithToken.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'Network error occurred' }])
    );
    const result = await computersClient.list();
    expect(result.isErr() && result.error[0]?.code).toBe('NETWORK_ERROR');
  });
});
