import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  DeleteEntityPropertyDocument,
  RenameEntitiesDocument,
  UpdateInitiativeDocument,
} from '@service-storage/graphql/generated/graphql';
import type { AnyVariables } from '@urql/core';
import type { DocumentNode } from 'graphql';
import { describe, expect, it } from 'vitest';
import { entityOptimisticResolvers } from './entity-optimistic-resolvers';

const predict = (document: DocumentNode, variables: AnyVariables) =>
  predictOptimisticMutation(entityOptimisticResolvers, document, variables);

describe('entity local resolvers', () => {
  it.each([
    ['DOCUMENT', 'GraphqlSoupDocument', 'documentName'],
    ['CHAT', 'GraphqlSoupChat', 'chatName'],
    ['PROJECT', 'GraphqlSoupProject', 'projectName'],
    ['CHANNEL', 'GraphqlSoupChannel', 'channelName'],
    ['CALL', 'GraphqlSoupCall', 'customName'],
  ])(
    'renames both the shared title and the %s field alias',
    (type, typename, field) => {
      const input = { entity: { type, id: 'entity' }, displayName: 'Renamed' };
      // GraphQL also accepts a singleton for a list input.
      for (const inputs of [input, [input]]) {
        expect(predict(RenameEntitiesDocument, { inputs })?.response).toEqual({
          renameEntities: {
            results: [
              {
                __typename: 'GraphqlMutationSuccess',
                effects: [
                  {
                    __typename: 'SoupUpdated',
                    item: {
                      __typename: typename,
                      id: 'entity',
                      displayName: 'Renamed',
                      [field]: 'Renamed',
                    },
                  },
                ],
              },
            ],
          },
        });
      }
    }
  );

  it('does not fabricate success for unsupported entities in a mixed batch', () => {
    expect(
      predict(RenameEntitiesDocument, {
        inputs: [
          { entity: { type: 'DOCUMENT', id: 'one' }, displayName: 'A' },
          { entity: { type: 'EMAIL_THREAD', id: 'two' }, displayName: 'B' },
        ],
      })
    ).toBeUndefined();
  });

  it('changes only supplied project fields, including an empty member list', () => {
    expect(
      predict(UpdateInitiativeDocument, {
        initiativeId: 'project',
        input: { memberIds: [] },
      })?.response
    ).toEqual({
      updateInitiative: {
        __typename: 'GraphqlSoupInitiative',
        id: 'project',
        memberIds: [],
      },
    });
    expect(
      predict(UpdateInitiativeDocument, {
        initiativeId: 'project',
        input: { name: 'Name' },
      })?.response
    ).toEqual({
      updateInitiative: {
        __typename: 'GraphqlSoupInitiative',
        id: 'project',
        displayName: 'Name',
      },
    });
  });

  it('waits for authoritative sharing results, including mixed edits', () => {
    for (const input of [
      {},
      { sharePermission: { linkShare: 'DISABLED' } },
      { name: 'Name', sharePermission: { teamShareAccessLevel: null } },
    ])
      expect(
        predict(UpdateInitiativeDocument, { initiativeId: 'project', input })
      ).toBeUndefined();
  });

  it.each([
    ['DOCUMENT', 'GraphqlSoupDocument'],
    ['INITIATIVE', 'GraphqlSoupInitiative'],
    ['CALL_RECORD', 'GraphqlSoupCall'],
    ['THREAD', 'GraphqlSoupEmailThread'],
  ])(
    'removes the assignment from its %s parent without deleting it before commit',
    (entityType, typename) => {
      const local = predict(DeleteEntityPropertyDocument, {
        entityType,
        entityId: 'parent',
        entityPropertyId: 'assignment',
      });
      expect(local?.options?.updates).toHaveLength(1);
      expect(local?.options?.updates?.[0]).toMatchObject({
        recordRoot: {
          entityKey: `${typename}:parent`,
          fragmentName: 'PropertyAssignmentParent',
        },
        path: [{ field: 'properties' }],
        operation: { kind: 'remove', entityKey: 'GraphqlProperty:assignment' },
      });
      expect(
        predict(DeleteEntityPropertyDocument, {
          entityType: 'USER',
          entityId: 'viewer',
          entityPropertyId: 'assignment',
        })
      ).toBeUndefined();
    }
  );
});
