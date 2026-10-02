import { describe, expect, it } from 'vitest';
import { buildPropertyAssignmentLinks } from './assignment-links';

describe('new property assignment links', () => {
  it.each([
    ['DOCUMENT', 'GraphqlSoupDocument'],
    ['CHAT', 'GraphqlSoupChat'],
    ['PROJECT', 'GraphqlSoupProject'],
    ['INITIATIVE', 'GraphqlSoupInitiative'],
    ['THREAD', 'GraphqlSoupEmailThread'],
    ['CHANNEL', 'GraphqlSoupChannel'],
    ['CALL_RECORD', 'GraphqlSoupCall'],
    ['COMPANY', 'GraphqlSoupCrmCompany'],
    ['DATABASE_ROW', 'GraphqlSoupDatabaseRow'],
  ] as const)(
    'targets a %s parent without any cache inspection',
    (entityType, typename) => {
      const patches = buildPropertyAssignmentLinks(
        entityType,
        'entity-1',
        'temporary-1',
        'priority'
      );
      expect(patches).toHaveLength(1);
      expect(patches[0]).toMatchObject({
        recordRoot: {
          fragmentName: 'PropertyAssignmentParent',
          entityKey: `${typename}:entity-1`,
        },
        variablesJson: '{}',
        path: [{ field: 'properties' }],
        operation: {
          kind: 'upsertByField',
          entityKey: 'GraphqlProperty:temporary-1',
          whereField: 'propertyDefinitionId',
          equals: 'priority',
        },
      });
      expect(patches[0].operationName).toBeUndefined();
      expect(patches[0].query).toContain('fragment PropertyAssignmentParent');
    }
  );

  it('does not invent a Soup identity for USER properties', () => {
    expect(
      buildPropertyAssignmentLinks('USER', 'user-1', 'temporary-1', 'priority')
    ).toEqual([]);
  });
});
