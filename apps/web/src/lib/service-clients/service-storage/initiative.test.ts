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
  __typename: 'GraphqlSoupInitiative',
  id: 'project-1',
  displayName: 'Launch',
  metadata: {
    ownerId: 'macro|owner@example.com',
    updatedAt: '2026-09-22T12:00:00Z',
    createdAt: '2026-09-20T12:00:00Z',
  },
  viewerPermission: {
    __typename: 'GraphqlAccessLevelPermission',
    accessLevel: 'COMMENT',
  },
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
  it('preserves project identity and sharing levels on detail reads', async () => {
    const { client, requests } = clientWith(() => ({
      data: { user: { initiative: project } },
    }));
    const signal = new AbortController().signal;
    const result = await client.get('project-1', signal);
    expect(requests).toHaveLength(1);
    expect(requests[0].variables).toEqual({ initiativeId: 'project-1' });
    expect(requests[0].context.fetchOptions).toEqual({ signal });
    expect(requests[0].context.requestPolicy).toBe('network-only');
    expect(result.isOk() && result.value).toMatchObject({
      id: 'project-1',
      name: 'Launch',
      ownerId: 'macro|owner@example.com',
      updatedAt: '2026-09-22T12:00:00Z',
      createdAt: '2026-09-20T12:00:00Z',
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

  it('keeps detail controls read-only when no viewer permission is returned', async () => {
    const { client } = clientWith(() => ({
      data: { user: { initiative: { ...project, viewerPermission: null } } },
    }));
    const result = await client.get('project-1');
    expect(result.isOk() && result.value.userAccessLevel).toBe('view');
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
});
