import { Telemetry } from '@macro-inc/observability';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchWithToken = vi.hoisted(() => vi.fn());
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));

import { agentHarnessServiceClient } from './client';

afterEach(() => {
  fetchWithToken.mockReset();
});

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('screen ticket errors', () => {
  it('tells the ticket rate limit apart from a computer with all its screens open', async () => {
    fetchWithToken.mockResolvedValue(ok({}));
    const span = Telemetry.span('test');
    await agentHarnessServiceClient.mintScreenTicket(
      'harness-1',
      { transport: 'vnc', surface: 'desktop', mode: 'view' },
      span
    );
    span.end();
    const handler = fetchWithToken.mock.calls[0][1].errorResponseHandler;
    expect(
      (await handler(response(429, { code: 'too_many_tickets' }))).code
    ).toBe('TOO_MANY_TICKETS');
    expect(
      (await handler(response(429, { code: 'too_many_screens' }))).code
    ).toBe('TOO_MANY_SCREENS');
    // An older harness says nothing: it can only be the rate limit.
    expect((await handler(response(429, {}))).code).toBe('TOO_MANY_TICKETS');
    expect(
      (await handler(response(403, { code: 'rollout_disabled' }))).code
    ).toBe('ROLLOUT_DISABLED');
  });
});
