import { describe, expect, it } from 'vitest';
import { canDeleteBot, canManageAgent } from '../botPermissions';

const CURRENT_USER = 'macro|current@example.com';
const CREATOR = 'macro|creator@example.com';
const TEAM_ID = 'team-1';

describe('canDeleteBot', () => {
  it('allows the owner of a private bot', () => {
    expect(
      canDeleteBot(
        {
          owner: { type: 'user', user_id: CURRENT_USER },
          created_by: CURRENT_USER,
        },
        CURRENT_USER,
        TEAM_ID,
        false
      )
    ).toBe(true);
  });

  it('allows either the creator or team owner for a team bot', () => {
    const bot = {
      owner: { type: 'team' as const, team_id: TEAM_ID },
      created_by: CREATOR,
    };

    expect(canDeleteBot(bot, CREATOR, TEAM_ID, false)).toBe(true);
    expect(canDeleteBot(bot, CURRENT_USER, TEAM_ID, true)).toBe(true);
  });

  it('rejects non-creator team members and owners of another team', () => {
    const bot = {
      owner: { type: 'team' as const, team_id: TEAM_ID },
      created_by: CREATOR,
    };

    expect(canDeleteBot(bot, CURRENT_USER, TEAM_ID, false)).toBe(false);
    expect(canDeleteBot(bot, CURRENT_USER, 'team-2', true)).toBe(false);
  });
});

describe('canManageAgent', () => {
  it('allows the owner of a private agent', () => {
    expect(
      canManageAgent(
        { owner: { type: 'user', user_id: CURRENT_USER } },
        CURRENT_USER,
        TEAM_ID
      )
    ).toBe(true);
  });

  it('rejects a coworker private agent that is only mentionable', () => {
    expect(
      canManageAgent(
        { owner: { type: 'user', user_id: CREATOR } },
        CURRENT_USER,
        TEAM_ID
      )
    ).toBe(false);
  });

  it("allows team-owned agents for the caller's current team", () => {
    expect(
      canManageAgent(
        { owner: { type: 'team', team_id: TEAM_ID } },
        CURRENT_USER,
        TEAM_ID
      )
    ).toBe(true);
  });

  it('rejects a team-owned agent from another team', () => {
    expect(
      canManageAgent(
        { owner: { type: 'team', team_id: 'team-2' } },
        CURRENT_USER,
        TEAM_ID
      )
    ).toBe(false);
  });
});
