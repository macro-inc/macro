import type { DirectoryChannel, DirectoryParticipant } from '../directory-core';
import { channelName } from './channel-uuid';

const CREATED = '2026-11-01T00:00:00+00:00';

/** A joined public channel as the directory holds it, for tests and browser
 * fixtures (no test runner imports, so a Vite fixture can use it). */
export function directoryChannel(
  id: string,
  overrides: Partial<DirectoryChannel> = {}
): DirectoryChannel {
  return {
    id,
    name: `channel ${channelName(id)}`,
    channelType: 'public',
    ownerId: 'macro|owner@example.com',
    organizationId: null,
    teamId: null,
    autoJoinTeam: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    viewedAt: null,
    interactedAt: null,
    isParticipant: true,
    frecencyScore: null,
    participants: [],
    botParticipants: [],
    agentDm: null,
    latestMessage: null,
    latestNonThreadMessage: null,
    ...overrides,
  };
}

/** A person in a directory channel, a member since the fixture's start. */
export function directoryParticipant(
  userId: string,
  overrides: Partial<DirectoryParticipant> = {}
): DirectoryParticipant {
  return {
    userId,
    role: 'member',
    joinedAt: CREATED,
    leftAt: null,
    ...overrides,
  };
}
