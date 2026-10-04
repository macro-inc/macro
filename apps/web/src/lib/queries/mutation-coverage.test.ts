import { getOperationAST, Kind, parse } from 'graphql';
import { expect, it } from 'vitest';
import { soupOptimisticResolvers } from './optimistic-resolvers';

// New documents must choose a strategy. Exceptions describe a real server-owned
// outcome; adding an empty optimistic response does not satisfy this gate.
const policies = {
  MarkEmailThreadSeen: 'resolver',
  MarkEmailThreadUnread: 'resolver',
  SetEmailThreadArchived: 'resolver',
  UpdateNotifications: 'resolver',
  RenameEntities: 'resolver',
  UpdateInitiative: 'resolver',
  DeleteEntityProperty: 'resolver',
  SaveEmailDraft: 'custom: draft identity and thread links',
  DeleteEmailDraft: 'custom: draft removal and thread links',
  SetFavorite: 'custom: favorite list membership',
  ReorderFavorites: 'custom: ordered favorite links',
  SetEntityProperty: 'custom: assignment identity and parent links',
  UpdateEntityPropertyOptions: 'custom: ordered option deltas',
  CreateInitiative: 'authoritative: server assigns project and description IDs',
  DeleteInitiative:
    'authoritative: boolean response; membership refresh after success',
  AssignInitiativeTasks:
    'authoritative: per-task permissions and assignment outcomes',
  ClearTaskInitiative:
    'authoritative: boolean response; membership refresh after success',
  RecordChannelActivity: 'authoritative: server event identity and timestamps',
  UpdateNotificationsForEntity:
    'authoritative: exact affected notification IDs required for undo',
  MoveEntities: 'inactive: UI uses other transports',
  UpdateEntitySharePolicies: 'inactive: UI uses other transports',
  TrashEntities: 'inactive: UI uses other transports',
  RestoreEntities: 'inactive: UI uses other transports',
  DeleteEntitiesPermanently: 'inactive: UI uses other transports',
  DuplicateEntities: 'inactive: UI uses other transports',
  SetEntityFavorite: 'inactive: UI uses SetFavorite',
} satisfies Record<
  string,
  | 'resolver'
  | `custom: ${string}`
  | `authoritative: ${string}`
  | `inactive: ${string}`
>;

it('requires an explicit optimistic strategy for every GraphQL mutation', () => {
  const documents = import.meta.glob(
    '../service-clients/service-storage/graphql/*.graphql',
    {
      query: '?raw',
      import: 'default',
      eager: true,
    }
  );
  const mutations = Object.values(documents).flatMap((source) =>
    parse(String(source)).definitions.flatMap((definition) =>
      definition.kind === Kind.OPERATION_DEFINITION &&
      definition.operation === 'mutation'
        ? [definition.name?.value]
        : []
    )
  );
  expect(mutations.sort()).toEqual(Object.keys(policies).sort());
  expect(new Set(mutations).size).toBe(mutations.length);
  expect(
    soupOptimisticResolvers
      .map((resolver) => getOperationAST(parse(resolver.document))?.name?.value)
      .sort()
  ).toEqual(
    Object.entries(policies)
      .filter(([, policy]) => policy === 'resolver')
      .map(([name]) => name)
      .sort()
  );
});
