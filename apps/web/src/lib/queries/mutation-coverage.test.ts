import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  buildSchema,
  getOperationAST,
  Kind,
  type OperationDefinitionNode,
  parse,
  print,
} from 'graphql';
import { expect, it } from 'vitest';
import schemaSource from '../../../../../static_assets/schema.graphql?raw';
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
  CreateCalendarEvent: 'custom: client event identity and occurrences',
  UpdateCalendarEvent: 'custom: event and occurrence edits',
  DeleteCalendarEvent: 'custom: event and occurrence removal',
  RespondToCalendarEvent: 'custom: attendee response',
  MarkWorkFeedItemsDone:
    'custom: feed rows stay hidden until the server removes them',
  CreateInitiative: 'authoritative: server assigns the project ID',
  DeleteInitiative:
    'authoritative: boolean response; membership refresh after success',
  EnsureInitiativeDescriptionSurface:
    'authoritative: server provisions the collaborative description surface',
  RenameDatabase:
    'authoritative: database metadata and SQL catalog reload after success',
  TrashDatabase:
    'authoritative: database list membership refreshes after success',
  RenameForm:
    'authoritative: form, database, and preview caches refresh after success',
  TrashForm: 'authoritative: form list membership refreshes after success',
  RecordChannelActivity: 'authoritative: server event identity and timestamps',
  UpdateNotificationsForEntity:
    'authoritative: exact affected notification IDs required for undo',
  UndoWorkFeedItemsDone:
    'authoritative: the server returns the restored feed entries',
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

// Resolvers are keyed by mutation field, so these documents reach one but must
// stay unpredicted. A prediction for a sample means its policy has changed.
const declinedByResolver = {
  RenameDatabase: { id: 'database', displayName: 'Renamed' },
  RenameForm: { id: 'form', displayName: 'Renamed' },
} satisfies Partial<Record<keyof typeof policies, Record<string, unknown>>>;

const mutations = Object.values(
  import.meta.glob('../service-clients/service-storage/graphql/*.graphql', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
).flatMap((source) =>
  parse(String(source)).definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION &&
      definition.operation === 'mutation'
  )
);
const policyOf = (operation: OperationDefinitionNode) =>
  policies[operation.name?.value as keyof typeof policies];
const resolvedFields = new Set(
  soupOptimisticResolvers.map((resolver) => resolver.field)
);
const reachesResolvers = (operation: OperationDefinitionNode) =>
  operation.selectionSet.selections.every(
    (selection) =>
      selection.kind === Kind.FIELD &&
      !selection.directives?.length &&
      (selection.name.value === '__typename' ||
        resolvedFields.has(selection.name.value))
  );
const names = (operations: OperationDefinitionNode[]) =>
  operations.map((operation) => operation.name?.value).sort();

it('requires an explicit optimistic strategy for every GraphQL mutation', () => {
  expect(names(mutations)).toEqual(Object.keys(policies).sort());
  expect(new Set(names(mutations)).size).toBe(mutations.length);
});

it('routes exactly the resolver policies through mutation field resolvers', () => {
  expect(
    names(
      mutations.filter(
        (operation) =>
          (policyOf(operation) === 'resolver') !== reachesResolvers(operation)
      )
    )
  ).toEqual(Object.keys(declinedByResolver).sort());
  expect(
    soupOptimisticResolvers.map(
      (resolver) =>
        policies[
          getOperationAST(resolver.document)?.name
            ?.value as keyof typeof policies
        ]
    )
  ).toEqual(soupOptimisticResolvers.map(() => 'resolver'));
});

it.each(Object.entries(declinedByResolver))(
  'keeps %s unpredicted although it reaches a field resolver',
  (name, variables) => {
    const operation = mutations.find(
      (mutation) => mutation.name?.value === name
    );
    expect(operation && reachesResolvers(operation)).toBe(true);
    expect(
      predictOptimisticMutation(
        soupOptimisticResolvers,
        { kind: Kind.DOCUMENT, definitions: [operation!] },
        variables
      )
    ).toBeUndefined();
  }
);

it('types resolver arguments with every schema argument of their field', () => {
  const fields = buildSchema(schemaSource).getMutationType()?.getFields();
  for (const resolver of soupOptimisticResolvers) {
    const variables = getOperationAST(resolver.document)?.variableDefinitions;
    expect(
      Object.fromEntries(
        variables?.map(({ variable, type }) => [
          variable.name.value,
          print(type),
        ]) ?? []
      ),
      resolver.field
    ).toEqual(
      Object.fromEntries(
        fields?.[resolver.field]?.args.map(({ name, type }) => [
          name,
          String(type),
        ]) ?? []
      )
    );
  }
});
