import { type TeamMember, TeamRole } from '@service-auth/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  canRemoveTeamMember,
  isTeamAdminOrOwner,
} from './teamMemberPermissions.ts';

const TEAM_ID = 'team-id';
const ACTING_USER_ID = 'acting-user-id';

function teamMember(userId: string, role: TeamRole): TeamMember {
  return {
    role,
    team_id: TEAM_ID,
    user_id: userId,
  };
}

describe('isTeamAdminOrOwner', function () {
  it.each([
    [TeamRole.owner, true],
    [TeamRole.admin, true],
    [TeamRole.member, false],
    [undefined, false],
  ])('identifies the %s role as authorized: %s', function (role, expected) {
    expect(isTeamAdminOrOwner(role)).toBe(expected);
  });
});

describe('canRemoveTeamMember', function () {
  const ordinaryMember = teamMember('member-id', TeamRole.member);
  const peerAdmin = teamMember('peer-admin-id', TeamRole.admin);
  const owner = teamMember('owner-id', TeamRole.owner);

  it.each([
    [TeamRole.owner, true],
    [TeamRole.admin, true],
    [TeamRole.member, false],
    [undefined, false],
  ])('allows the %s role to remove an ordinary member: %s', function (role, expected) {
    expect(canRemoveTeamMember(ACTING_USER_ID, role, ordinaryMember)).toBe(
      expected
    );
  });

  it.each([
    TeamRole.owner,
    TeamRole.admin,
  ])('allows the %s role to remove a peer admin', function (role) {
    expect(canRemoveTeamMember(ACTING_USER_ID, role, peerAdmin)).toBe(true);
  });

  it.each([
    TeamRole.owner,
    TeamRole.admin,
  ])('prevents the %s role from removing themselves', function (role) {
    const actingMember = teamMember(ACTING_USER_ID, role);

    expect(canRemoveTeamMember(ACTING_USER_ID, role, actingMember)).toBe(false);
  });

  it.each([
    TeamRole.owner,
    TeamRole.admin,
  ])('prevents the %s role from removing the owner', function (role) {
    expect(canRemoveTeamMember(ACTING_USER_ID, role, owner)).toBe(false);
  });

  it('prevents removal when the acting user ID is unavailable', function () {
    expect(canRemoveTeamMember(undefined, TeamRole.admin, ordinaryMember)).toBe(
      false
    );
  });
});
