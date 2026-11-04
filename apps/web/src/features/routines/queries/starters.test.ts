import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { starterStepsQueryOptions } from './starters';

const clients = vi.hoisted(() => ({ codeStarters: vi.fn() }));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { codeStarters: clients.codeStarters },
}));

describe('starter steps', () => {
  it('reads the scheduler’s code for each known template', async () => {
    clients.codeStarters.mockResolvedValue(
      ok([
        {
          key: 'inbox',
          request: 'Label new email',
          steps: [
            {
              type: 'code',
              title: 'Label by topic',
              summary: 'Labels it.',
              source: 'export async function main() {}',
            },
          ],
        },
        // A starter this client doesn't know isn't offered.
        { key: 'later', request: 'Later', steps: [] },
      ])
    );
    const steps = await new QueryClient().fetchQuery(
      starterStepsQueryOptions()
    );
    expect(Object.keys(steps)).toEqual(['inbox']);
    expect(steps.inbox).toMatchObject([
      { kind: 'code', title: 'Label by topic' },
    ]);
  });
});
