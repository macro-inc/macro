// In-memory stand-ins for the auth service and the signed-in user, following
// the server's rules for teams: the creator manages a new team, managers and
// workspace admins change it, anyone joins an open team, and teams nest one
// level.
import type { CreateSubteamRequest } from '@service-auth/generated/schemas/createSubteamRequest';
import type { Subteam } from '@service-auth/generated/schemas/subteam';
import type { SubteamRole } from '@service-auth/generated/schemas/subteamRole';
import type { Team } from '@service-auth/generated/schemas/team';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import type { UpdateSubteamRequest } from '@service-auth/generated/schemas/updateSubteamRequest';
import { err, ok } from 'neverthrow';

// Everything else the app imports from these modules stays real.
export * from '../../../../lib/core/context/emailLinks';
export * from '../../../../lib/core/context/user';
export * from '../../../../lib/service-clients/service-auth/client';

const PEOPLE = [
  ['macro|ada@example.com', 'Ada', 'Lovelace', 'owner'],
  ['macro|grace@example.com', 'Grace', 'Hopper', 'member'],
  ['macro|alan@example.com', 'Alan', 'Turing', 'member'],
  ['macro|linus@example.com', 'Linus', 'Pauling', 'member'],
  ['macro|rosalind@example.com', 'Rosalind', 'Franklin', 'member'],
] as const;

/** `?as=grace` signs in as Grace; Ada, the workspace owner, otherwise. */
const viewerId = `macro|${new URLSearchParams(location.search).get('as') ?? 'ada'}@example.com`;

const team: Team = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Acme',
  slug: 'ACME',
  owner_id: 'macro|ada@example.com',
  allow_non_admin_invites: true,
  crm_enabled: false,
  enterprise: false,
};

const workspace: TeamWithMembers = {
  team,
  members: PEOPLE.map(([user_id, , , role]) => ({
    team_id: team.id,
    user_id,
    role,
    plan: 'premium',
  })),
};

let nextId = 3;
let subteams: Subteam[] = [
  {
    id: 'aaaaaaaa-0000-7000-8000-000000000001',
    parentId: null,
    name: 'Engineering',
    description: 'Everyone who ships code',
    color: 'blue',
    joinPolicy: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    members: [
      { userId: 'macro|ada@example.com', role: 'manager' },
      { userId: 'macro|alan@example.com', role: 'member' },
    ],
  },
  {
    id: 'aaaaaaaa-0000-7000-8000-000000000002',
    parentId: 'aaaaaaaa-0000-7000-8000-000000000001',
    name: 'Platform',
    description: 'Sync, storage and infrastructure',
    color: 'teal',
    joinPolicy: 'invite_only',
    createdAt: '2026-01-02T00:00:00Z',
    members: [{ userId: 'macro|alan@example.com', role: 'manager' }],
  },
];

const isWorkspaceAdmin = PEOPLE.some(
  ([userId, , , role]) => userId === viewerId && role !== 'member'
);

function find(subteamId: string) {
  return subteams.find((subteam) => subteam.id === subteamId);
}

function manages(subteam: Subteam) {
  return (
    isWorkspaceAdmin ||
    subteam.members.some(
      (member) => member.userId === viewerId && member.role === 'manager'
    )
  );
}

function save(subteam: Subteam) {
  subteams = subteams.map((existing) =>
    existing.id === subteam.id ? subteam : existing
  );
  return ok(structuredClone(subteam));
}

function refuse(message: string) {
  return err([{ code: 'HTTP_ERROR', message }]);
}

export const authServiceClient = {
  async getTeam() {
    return ok(workspace);
  },
  async getUserTeams() {
    return ok([team]);
  },
  async getUserNamesWithEmail(args: { user_ids: string[] }) {
    return ok({
      names: PEOPLE.filter(([id]) => args.user_ids.includes(id)).map(
        ([id, first_name, last_name]) => ({
          id,
          first_name,
          last_name,
          is_agent: false,
        })
      ),
    });
  },
  async listSubteams() {
    return ok({ subteams: structuredClone(subteams) });
  },
  async createSubteam(request: CreateSubteamRequest) {
    const parent = request.parentId ? find(request.parentId) : undefined;
    if (request.parentId && (!parent || parent.parentId))
      return refuse('invalid parent');

    const created: Subteam = {
      id: `aaaaaaaa-0000-7000-8000-00000000000${nextId++}`,
      parentId: request.parentId ?? null,
      name: request.name.trim(),
      description: request.description ?? '',
      color: request.color,
      joinPolicy: request.joinPolicy,
      createdAt: new Date().toISOString(),
      members: [
        { userId: viewerId, role: 'manager' },
        ...(request.memberIds ?? []).map((userId) => ({
          userId,
          role: 'member' as const,
        })),
      ],
    };
    subteams = [...subteams, created];
    return ok(structuredClone(created));
  },
  async updateSubteam(subteamId: string, request: UpdateSubteamRequest) {
    const subteam = find(subteamId);
    if (!subteam) return refuse('not found');
    if (!manages(subteam)) return refuse('not a manager');

    return save({
      ...subteam,
      name: request.name ?? subteam.name,
      description: request.description ?? subteam.description,
      color: request.color ?? subteam.color,
      joinPolicy: request.joinPolicy ?? subteam.joinPolicy,
    });
  },
  async nestSubteam(subteamId: string, parentId: string | null) {
    const subteam = find(subteamId);
    if (!subteam) return refuse('not found');
    if (!manages(subteam)) return refuse('not a manager');

    const parent = parentId ? find(parentId) : undefined;
    const hasChildren = subteams.some((other) => other.parentId === subteamId);
    if (parentId && (!parent || parent.parentId || hasChildren))
      return refuse('invalid parent');

    return save({ ...subteam, parentId });
  },
  async deleteSubteam(subteamId: string) {
    const subteam = find(subteamId);
    if (!subteam) return refuse('not found');
    if (!manages(subteam)) return refuse('not a manager');

    subteams = subteams
      .filter((other) => other.id !== subteamId)
      .map((other) =>
        other.parentId === subteamId ? { ...other, parentId: null } : other
      );
    return ok(undefined);
  },
  async saveSubteamMember(
    subteamId: string,
    userId: string,
    role: SubteamRole
  ) {
    const subteam = find(subteamId);
    if (!subteam) return refuse('not found');

    const joining = userId === viewerId && role === 'member';
    if (!manages(subteam) && !(joining && subteam.joinPolicy === 'open'))
      return refuse('not allowed');

    const others = subteam.members.filter((member) => member.userId !== userId);
    return save({ ...subteam, members: [...others, { userId, role }] });
  },
  async removeSubteamMember(subteamId: string, userId: string) {
    const subteam = find(subteamId);
    if (!subteam) return refuse('not found');
    if (userId !== viewerId && !manages(subteam)) return refuse('not allowed');

    return save({
      ...subteam,
      members: subteam.members.filter((member) => member.userId !== userId),
    });
  },
};

export const useUserId = () => () => viewerId;
export const useIsAuthenticated = () => () => true;
export const useEmail = () => () => viewerId.slice('macro|'.length);

export const useEmailLinksContext = () => ({
  links: () => [],
  isConnectedSecondaryInbox: () => false,
});
