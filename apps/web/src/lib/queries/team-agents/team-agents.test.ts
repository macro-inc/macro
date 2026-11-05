import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@service-auth/client', () => ({
  authServiceClient: { quoteTeamAgent: vi.fn() },
}));

import { authServiceClient } from '@service-auth/client';
import { QueryClient } from '@tanstack/solid-query';
import { teamAgentQuoteQueryOptions, teamAgentsQueryOptions } from './index';

describe('team agents queries', () => {
  it('scopes quotes by team and size and reads the server total', async () => {
    const quote = {
      seat: 2000,
      computer: 3000,
      total: 5000,
      currency: 'usd',
      interval: 'month' as const,
    };
    vi.mocked(authServiceClient.quoteTeamAgent).mockResolvedValue(ok(quote));
    const client = new QueryClient();
    try {
      expect(
        await client.fetchQuery(teamAgentQuoteQueryOptions('team-1', 'large'))
      ).toEqual(quote);
      expect(authServiceClient.quoteTeamAgent).toHaveBeenCalledWith('large');
      expect(
        teamAgentQuoteQueryOptions('team-1', 'large').queryKey
      ).not.toEqual(teamAgentQuoteQueryOptions('team-1', 'standard').queryKey);
      expect(teamAgentsQueryOptions('team-1').queryKey).not.toEqual(
        teamAgentsQueryOptions('team-2').queryKey
      );
    } finally {
      client.clear();
    }
  });
});
