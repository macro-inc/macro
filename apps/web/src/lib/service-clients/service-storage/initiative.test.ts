import {
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => {
    throw new Error('The test must inject a client');
  },
  mapGraphqlProperties: () => [],
}));

import type { InitiativeDetailFieldsFragment } from './graphql/generated/graphql';
import { createInitiativeClient, initiativeUpdateInput } from './initiative';

const project = {
  __typename: 'GraphqlInitiative',
  id: 'project-1',
  name: 'Launch',
  descriptionDocumentId: 'description-1',
  updatedAt: '2026-09-22T12:00:00Z',
  createdAt: '2026-09-20T12:00:00Z',
  userAccessLevel: 'COMMENT',
  ownerId: 'macro|owner@example.com',
  memberIds: [],
  taskIds: ['task-1'],
  taskCount: 1,
  completedTaskCount: 0,
  properties: [],
  sharePermission: {
    __typename: 'InitiativeSharePermission',
    id: 'share-1',
    owner: 'macro|owner@example.com',
    linkShare: 'TEAM',
    linkShareAccessLevel: 'VIEW',
    teamShareAccessLevel: 'COMMENT',
    channelSharePermissions: [{ channelId: 'channel-1', accessLevel: 'EDIT' }],
  },
} satisfies InitiativeDetailFieldsFragment;

function clientWith(
  reply: (operation: Operation) => Pick<OperationResult, 'data' | 'error'>
) {
  const requests: Operation[] = [];
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind !== 'teardown'),
      map((operation) => {
        requests.push(operation);
        return { operation, stale: false, hasNext: false, ...reply(operation) };
      })
    );
  const graphql = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
  return { client: createInitiativeClient(() => graphql), requests };
}

describe('initiative GraphQL transport', () => {
  it('maps collection filters, pagination and access without a second property request', async () => {
    const { client, requests } = clientWith(() => ({
      data: {
        user: {
          initiatives: { initiatives: [project], nextCursor: 'next-page' },
        },
      },
    }));
    const signal = new AbortController().signal;
    const result = await client.page(
      { query: 'Launch', sort: 'due', descending: false, cursor: 'page-2' },
      signal
    );
    expect(result.isOk() && result.value).toMatchObject({
      initiatives: [
        { id: 'project-1', userAccessLevel: 'comment', properties: [] },
      ],
      nextCursor: 'next-page',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].variables).toEqual({
      input: {
        query: 'Launch',
        sort: 'DUE',
        descending: false,
        cursor: 'page-2',
      },
    });
    expect(requests[0].context.fetchOptions).toEqual({ signal });
    expect(requests[0].context.requestPolicy).toBe('network-only');
  });

  it('pages project membership through GraphQL before task hydration', async () => {
    const { client, requests } = clientWith(() => ({
      data: {
        user: {
          initiativeTasks: {
            taskIds: ['task-2'],
            nextCursor: 'next',
            total: 3,
          },
        },
      },
    }));
    const result = await client.tasks('project-1', {
      limit: 1,
      cursor: 'previous',
    });
    expect(requests[0].variables).toEqual({
      initiativeId: 'project-1',
      input: { limit: 1, cursor: 'previous' },
    });
    expect(result.isOk() && result.value).toEqual({
      taskIds: ['task-2'],
      nextCursor: 'next',
      total: 3,
    });
  });

  it('preserves project identity and sharing levels on detail reads', async () => {
    const { client } = clientWith(() => ({
      data: { user: { initiative: project } },
    }));
    const result = await client.get('project-1');
    expect(result.isOk() && result.value).toMatchObject({
      id: 'project-1',
      descriptionDocumentId: 'description-1',
      userAccessLevel: 'comment',
      taskIds: ['task-1'],
      sharePermission: {
        linkShare: 'TEAM',
        linkShareAccessLevel: 'view',
        teamShareAccessLevel: 'comment',
        channelSharePermissions: [
          { channel_id: 'channel-1', access_level: 'edit' },
        ],
      },
    });
  });

  it('keeps omitted sharing fields distinct from explicit null when serializing a patch', () => {
    const patch = initiativeUpdateInput({
      sharePermission: {
        teamShareAccessLevel: null,
        channelSharePermissions: [
          { channelId: 'channel-1', operation: 'replace', accessLevel: 'edit' },
        ],
      },
    });
    expect(JSON.parse(JSON.stringify(patch))).toEqual({
      sharePermission: {
        teamShareAccessLevel: null,
        channelSharePermissions: [
          { channelId: 'channel-1', operation: 'REPLACE', accessLevel: 'EDIT' },
        ],
      },
    });
  });

  it('preserves authorization codes and rejects partial cached identity on access loss', async () => {
    const { client } = clientWith(() => ({
      data: { user: { initiative: project } },
      error: new CombinedError({
        graphQLErrors: [
          { message: 'Access revoked', extensions: { code: 'FORBIDDEN' } },
        ],
      }),
    }));
    const result = await client.get('project-1');
    expect(result.isErr() && result.error).toEqual([
      { code: 'FORBIDDEN', message: 'Access revoked' },
    ]);
  });

  it('rejects data that arrives after cancellation, even when the exchange returns it', async () => {
    const controller = new AbortController();
    const { client } = clientWith(() => {
      controller.abort();
      return { data: { user: { initiative: project } } };
    });
    const result = await client.get('project-1', controller.signal);
    expect(result.isErr()).toBe(true);
  });

  it('does not expose a restricted task relationship', async () => {
    const { client, requests } = clientWith(() => ({
      data: {
        user: {
          taskInitiativeReferences: [
            { taskId: 'task-1', state: 'UNAVAILABLE', initiative: null },
            {
              taskId: 'task-2',
              state: 'VISIBLE',
              initiative: { id: 'project-1', name: 'Launch' },
            },
          ],
        },
      },
    }));
    const result = await client.taskReferences(['task-1', 'task-2']);
    expect(requests[0].variables).toEqual({ taskIds: ['task-1', 'task-2'] });
    expect(result.isOk() && result.value.references).toEqual([
      { taskId: 'task-1', state: 'unavailable', initiative: null },
      {
        taskId: 'task-2',
        state: 'visible',
        initiative: { id: 'project-1', name: 'Launch' },
      },
    ]);
  });

  it('preserves per-task failures instead of treating a batch response as full success', async () => {
    const { client, requests } = clientWith(() => ({
      data: {
        assignInitiativeTasks: [
          { taskId: 'task-1', status: 'MOVED' },
          { taskId: 'task-2', status: 'SKIPPED_NO_PERMISSION' },
          { taskId: 'task-3', status: 'NOT_A_TASK' },
        ],
      },
    }));
    const result = await client.assignTasks('project-1', {
      taskIds: ['task-1', 'task-2', 'task-3'],
    });
    expect(requests[0].kind).toBe('mutation');
    expect(result.isOk() && result.value.results).toEqual([
      { taskId: 'task-1', status: 'moved' },
      { taskId: 'task-2', status: 'skippedNoPermission' },
      { taskId: 'task-3', status: 'notATask' },
    ]);
  });
});
