import { describe, expect, it } from 'vitest';
import {
  canDirectMessagePersona,
  selectConversationRecipients,
} from './personas';

describe('private agent recipients', () => {
  it('offers owned and team personas without granting DMs through a shared channel', () => {
    expect(
      canDirectMessagePersona({ type: 'user', user_id: 'me' }, 'me', 'team')
    ).toBe(true);
    expect(
      canDirectMessagePersona({ type: 'team', team_id: 'team' }, 'me', 'team')
    ).toBe(true);
    expect(
      canDirectMessagePersona(
        { type: 'user', user_id: 'teammate' },
        'me',
        'team'
      )
    ).toBe(false);
    expect(
      canDirectMessagePersona(
        { type: 'team', team_id: 'former-team' },
        'me',
        'team'
      )
    ).toBe(false);
    expect(canDirectMessagePersona(undefined, 'me', 'team')).toBe(false);
  });

  it('switches between a private agent DM and a human group without mixing them', () => {
    const alice = { kind: 'user', id: 'alice' };
    const bob = { kind: 'user', id: 'bob' };
    const agent = { kind: 'agent', id: 'researcher' };
    expect(selectConversationRecipients([alice, bob, agent])).toEqual([agent]);
    expect(selectConversationRecipients([agent, alice])).toEqual([alice]);
    expect(selectConversationRecipients([alice, bob])).toEqual([alice, bob]);
    expect(selectConversationRecipients([])).toEqual([]);
  });
});
