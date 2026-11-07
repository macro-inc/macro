import { describe, expect, it } from 'vitest';
import {
  teamAgentComputerErrorResponseHandler,
  teamAgentCreateErrorResponseHandler,
  teamAgentQuoteErrorResponseHandler,
} from './team-agent-errors';

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

describe('agent create repository failures', () => {
  it('preserves the safe reason only for the typed pre-purchase failure', async () => {
    const safeReason =
      'The workspace repository service is missing git. Nothing was charged.';
    expect(
      await teamAgentCreateErrorResponseHandler(
        Response.json(
          { code: 'repository_creation_failed', message: safeReason },
          { status: 502 }
        )
      )
    ).toEqual({ code: 'repository_creation_failed', message: safeReason });
    for (const response of [
      Response.json(
        { code: 'provider_failed', message: 'private details' },
        { status: 502 }
      ),
      Response.json({ message: 'private details' }, { status: 502 }),
      new Response('not json', { status: 502 }),
    ]) {
      const error = await teamAgentCreateErrorResponseHandler(response);
      expect(error.code).not.toBe('repository_creation_failed');
      expect(error.message).not.toContain('private details');
    }
  });
});

it('preserves a changed billing mode without exposing unknown conflicts', async () => {
  expect(
    (
      await teamAgentCreateErrorResponseHandler(
        Response.json({ code: 'quote_changed' }, { status: 409 })
      )
    ).code
  ).toBe('quote_changed');
  expect(
    (
      await teamAgentCreateErrorResponseHandler(
        Response.json({ code: 'other', message: 'private' }, { status: 409 })
      )
    ).code
  ).toBe('CONFLICT');
});

describe('computer discovery availability', () => {
  it('classifies dedicated discovery 503 without inspecting message text', async () => {
    expect(
      await teamAgentComputerErrorResponseHandler(
        Response.json(
          { message: 'computers are not available' },
          { status: 503 }
        )
      )
    ).toEqual({
      code: 'COMPUTERS_UNAVAILABLE',
      message: 'Computers are not available.',
    });
  });
  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [500, 'SERVER_ERROR'],
  ])('preserves discovery status %s as an error', async (status, code) => {
    expect(
      (
        await teamAgentComputerErrorResponseHandler(
          Response.json(
            { message: 'computers are not available' },
            { status: Number(status) }
          )
        )
      ).code
    ).toBe(code);
  });
});
