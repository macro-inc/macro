import { describe, expect, it } from 'vitest';
import {
  buildTeamSharePayload,
  getTeamShareRowLabel,
  TEAM_SHARE_ROW_COPY,
} from './teamShare';

describe('buildTeamSharePayload', () => {
  it.each(['view', 'comment', 'edit'] as const)(
    'sends %s to share the item with the whole team',
    (accessLevel) => {
      expect(buildTeamSharePayload(accessLevel, null)).toEqual({
        teamShareAccessLevel: accessLevel,
      });
    }
  );

  it('sends an explicit null to stop sharing with the team', () => {
    expect(buildTeamSharePayload(null, 'edit')).toEqual({
      teamShareAccessLevel: null,
    });
  });

  it('changes the level of an existing team share', () => {
    expect(buildTeamSharePayload('view', 'edit')).toEqual({
      teamShareAccessLevel: 'view',
    });
  });

  it('omits the payload when the level is unchanged', () => {
    expect(buildTeamSharePayload('edit', 'edit')).toBeUndefined();
    expect(buildTeamSharePayload(null, null)).toBeUndefined();
    expect(buildTeamSharePayload(null, undefined)).toBeUndefined();
  });

  it('never grants owner to a team', () => {
    expect(buildTeamSharePayload('owner', null)).toBeUndefined();
    expect(buildTeamSharePayload('owner', 'edit')).toBeUndefined();
  });
});

describe('getTeamShareRowLabel', () => {
  it('uses the team name when known', () => {
    expect(getTeamShareRowLabel('Acme')).toBe('Acme');
  });

  it.each([undefined, null, '', '   '])(
    'falls back to the generic label for %s',
    (teamName) => {
      expect(getTeamShareRowLabel(teamName)).toBe(
        TEAM_SHARE_ROW_COPY.fallbackLabel
      );
    }
  );
});
