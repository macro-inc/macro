import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import {
  EntityActivityDocument,
  type EntityActivityQuery,
  type EntityActivityQueryVariables,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityEvent, ActivityTopEntity } from '../core/event';
import { decodeActivityEvent } from './decode';

/** One bounded query, with server-side access checks, for recent workspace work. */
export function createWorkspaceActivityQuery(
  context: Pick<ActivityContext, 'graphql'>,
  enabled: Accessor<boolean>
) {
  return createUrqlQuery<
    EntityActivityQuery,
    EntityActivityQueryVariables,
    ActivityEvent[]
  >(() => ({
    query: EntityActivityDocument,
    client: context.graphql(),
    variables: {
      input: {
        initial: {
          limit: 32,
          expand: true,
          sortMethod: 'UPDATED_AT',
          emailView: 'ALL',
          filters: {
            chatFilter: {
              literal: { chatId: '00000000-0000-0000-0000-000000000000' },
            },
          },
        },
      },
      limit: 16,
    },
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: (data) =>
      data.user.soup.items.flatMap((item) =>
        item.activity.map(decodeActivityEvent)
      ),
  }));
}

type OrExpression<T> =
  | T
  | { or: { left: OrExpression<T>; right: OrExpression<T> } };
function anyOf<T>(values: T[]): OrExpression<T> | undefined {
  return values.reduce<OrExpression<T> | undefined>(
    (left, right) => (left ? { or: { left, right } } : right),
    undefined
  );
}

/** Exact entity filters keep every unrelated Soup branch excluded. */
export function buildRelatedActivityInput(
  entities: Pick<ActivityTopEntity, 'entityId' | 'entityType'>[]
): SoupInput | undefined {
  if (!entities.length) return undefined;
  const base = buildGraphqlEntitySoupInput(
    'DOCUMENT',
    '00000000-0000-0000-0000-000000000000'
  )!;
  const ids = (type: ActivityTopEntity['entityType']) =>
    entities
      .filter((entity) => entity.entityType === type)
      .map((entity) => entity.entityId);
  const documentFilter = anyOf(
    ids('document').map((id) => ({ literal: { id } }))
  );
  const projectFilter = anyOf(
    ids('project').map((projectIdSelf) => ({ literal: { projectIdSelf } }))
  );
  const channelFilter = anyOf(
    ids('channel').map((channelId) => ({ literal: { channelId } }))
  );
  const chatFilter = anyOf(
    ids('chat').map((chatId) => ({ literal: { chatId } }))
  );
  const emailTree = anyOf(
    ids('email-thread').map((threadId) => ({ literal: { threadId } }))
  );
  return {
    initial: {
      ...base.initial,
      limit: entities.length,
      filters: {
        ...base.initial?.filters,
        ...(documentFilter && { documentFilter }),
        ...(projectFilter && { projectFilter }),
        ...(channelFilter && { channelFilter }),
        ...(chatFilter && { chatFilter }),
        ...(emailTree && { emailFilter: { tree: emailTree } }),
      },
    },
  };
}

/** Fill in collaborators on the user's most active work in one additional batch. */
export function createRelatedActivityQuery(
  context: Pick<ActivityContext, 'graphql'>,
  entities: Accessor<Pick<ActivityTopEntity, 'entityId' | 'entityType'>[]>,
  enabled: Accessor<boolean>
) {
  const input = createMemo(
    () => buildRelatedActivityInput(entities()),
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );
  return createUrqlQuery<
    EntityActivityQuery,
    EntityActivityQueryVariables,
    ActivityEvent[]
  >(() => ({
    query: EntityActivityDocument,
    client: context.graphql(),
    variables: { input: input()!, limit: 20 },
    enabled: enabled() && input() !== undefined,
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: (data) =>
      data.user.soup.items.flatMap((item) =>
        item.activity.map(decodeActivityEvent)
      ),
  }));
}
