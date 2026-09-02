import type { Client } from '@urql/core';
import type { ActivityDeps, OpenEntityTarget } from '../deps';
import { createFakeGraphql, type FakeGraphql } from './fake-graphql';

export const FAKE_VIEWER_ID = 'macro|me@example.com';

export type FakeActivityDeps = ActivityDeps & {
  graphqlFake: FakeGraphql;
  opened: OpenEntityTarget[];
};

/**
 * In-memory implementations of every activity dependency. Entities resolve
 * to `Entity <id>` and open as markdown blocks; actor ids of the form
 * `macro|name@…` resolve to `name`, anything else reads as automation.
 */
export function createFakeActivityDeps(
  overrides: Partial<ActivityDeps> = {}
): FakeActivityDeps {
  const graphqlFake = createFakeGraphql();
  const opened: OpenEntityTarget[] = [];
  const client: Client = graphqlFake.client;
  return {
    graphql: () => client,
    currentUserId: () => FAKE_VIEWER_ID,
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
    graphqlFake,
    opened,
  };
}
