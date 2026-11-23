import { describe, expect, it } from 'vitest';
import { callWorkAccounts, dmWorkAccount } from './work-visibility';

const isAgentAccount = (id: string) => id === 'macro|agent@example.com';

describe('dmWorkAccount', () => {
  it('picks the other account when it is an agent', () => {
    expect(
      dmWorkAccount({
        isDirectMessage: true,
        participantIds: ['macro|me@example.com', 'macro|agent@example.com'],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBe('macro|agent@example.com');
  });

  it('shows nothing in a DM with a person', () => {
    expect(
      dmWorkAccount({
        isDirectMessage: true,
        participantIds: ['macro|me@example.com', 'macro|person@example.com'],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBeUndefined();
  });

  it('shows nothing in a group or a channel', () => {
    expect(
      dmWorkAccount({
        isDirectMessage: true,
        participantIds: [
          'macro|me@example.com',
          'macro|agent@example.com',
          'macro|person@example.com',
        ],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBeUndefined();
    expect(
      dmWorkAccount({
        isDirectMessage: false,
        participantIds: ['macro|me@example.com', 'macro|agent@example.com'],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBeUndefined();
  });
});

describe('callWorkAccounts', () => {
  it('ignores guests and repeat connections, whatever the join order', () => {
    expect(
      callWorkAccounts([
        'macro|b@example.com',
        undefined,
        'macro|a@example.com',
        'macro|b@example.com',
      ])
    ).toEqual(['macro|a@example.com', 'macro|b@example.com']);
  });
});
