import { describe, expect, it } from 'vitest';
import { teamAgentQuoteErrorResponseHandler } from './team-agent-errors';

describe('agent quote billing conflicts', () => {
  it('preserves only the typed no_subscription conflict', async () => {
    expect(
      (
        await teamAgentQuoteErrorResponseHandler(
          Response.json(
            { code: 'no_subscription', message: 'plan required' },
            { status: 409 }
          )
        )
      ).code
    ).toBe('no_subscription');
    expect(
      (
        await teamAgentQuoteErrorResponseHandler(
          Response.json({ code: 'computer_unavailable' }, { status: 409 })
        )
      ).code
    ).toBe('CONFLICT');
    expect(
      (
        await teamAgentQuoteErrorResponseHandler(
          Response.json({}, { status: 403 })
        )
      ).code
    ).toBe('FORBIDDEN');
  });
});
