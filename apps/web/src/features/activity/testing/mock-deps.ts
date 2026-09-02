import type { Client } from '@urql/core';
import type { ActivityDeps, OpenEntityTarget } from '../deps';
import { createMockGraphql, type MockGraphql } from './mock-graphql';

export const MOCK_VIEWER_ID = 'macro|me@example.com';

export type MockActivityDeps = ActivityDeps & {
  graphqlMock: MockGraphql;
  opened: OpenEntityTarget[];
};

/**
 * In-memory implementations of every activity dependency. Entities resolve
 * to `Entity <id>` and open as markdown blocks; actor ids of the form
 * `macro|name@…` resolve to `name`, anything else reads as automation.
 */
export function createMockActivityDeps(
  overrides: Partial<ActivityDeps> = {}
): MockActivityDeps {
  const graphqlMock = createMockGraphql();
  const opened: OpenEntityTarget[] = [];
  const client: Client = graphqlMock.client;
  return {
    graphql: () => client,
    currentUserId: () => MOCK_VIEWER_ID,
    displayName: (actorId) => {
      const id = actorId();
      if (!id.startsWith('macro|')) return () => undefined;
      return () => id.slice('macro|'.length).split('@')[0] ?? '';
    },
    entityDisplay: (entityId) => ({
      name: () => `Entity ${entityId()}`,
      icon: () => null,
      isLoading: () => false,
      blockOrFileType: () => 'md',
      linkParams: () => undefined,
    }),
    openEntity: (target) => {
      opened.push(target);
    },
    propertyDefinition: () => () => undefined,
    timeZone: () => 'UTC',
    ...overrides,
    graphqlMock,
    opened,
  };
}
