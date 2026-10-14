import type { EmailThreadPreparedBodiesQuery } from '@service-storage/graphql/generated/graphql';
import { expect, it, vi } from 'vitest';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));
vi.mock('@graphql-cache/solid/create-live-query', () => ({
  createLiveQuery: vi.fn(),
}));

import { preparedBodiesById, SERVER_PREPARE_VERSION } from './prepared-bodies';

const prepared = (version: number) => ({
  __typename: 'GraphqlPreparedEmailBody' as const,
  version,
  html: '<p>Hi</p>',
  hasTable: false,
  hasHiddenContent: true,
  imageProxyUrl: 'https://gateway.test/image-proxy/proxy',
  sourceLength: 9,
});

it('keeps bodies of this client version, by message id', () => {
  const data = {
    user: {
      id: 'user',
      emailThread: {
        __typename: 'GraphqlSoupEmailThread',
        id: 'thread',
        messages: [
          {
            __typename: 'GraphqlSoupEmailMessage',
            id: 'a',
            preparedBody: prepared(SERVER_PREPARE_VERSION),
          },
          {
            __typename: 'GraphqlSoupEmailMessage',
            id: 'b',
            preparedBody: prepared(SERVER_PREPARE_VERSION + 1),
          },
          {
            __typename: 'GraphqlSoupEmailMessage',
            id: 'c',
            preparedBody: null,
          },
        ],
      },
    },
  } as unknown as EmailThreadPreparedBodiesQuery;
  const bodies = preparedBodiesById(data);
  expect([...bodies.keys()]).toEqual(['a']);
  expect(bodies.get('a')).toEqual({
    body: {
      html: '<p>Hi</p>',
      kind: 'html',
      hasTable: false,
      hasHiddenContent: true,
    },
    imageProxyUrl: 'https://gateway.test/image-proxy/proxy',
    sourceLength: 9,
  });
});
