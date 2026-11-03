import { CombinedError, createClient, createRequest, gql } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { createQueryAuthorization } from './authorization';

const document = gql`query Viewer { viewer { id } }`;

describe('createQueryAuthorization', () => {
  it('shares denial across consumers and rejects success started before the denial', () => {
    const client = createClient({ url: 'http://test/graphql', exchanges: [] });
    const first = createQueryAuthorization(() => 'viewer:project', client);
    const second = createQueryAuthorization(() => 'viewer:project', client);
    const oldOperation = client.createRequestOperation(
      'query',
      createRequest(document, {}),
      first.requestContext()
    );
    const deniedOperation = client.createRequestOperation(
      'query',
      createRequest(document, {}),
      second.requestContext()
    );
    const denial = new CombinedError({ graphQLErrors: ['Forbidden'] });

    second.onResult({
      stale: false,
      hasNext: false,
      operation: deniedOperation,
      error: denial,
      extensions: { __macroNormalizedCache: { source: 'live-network' } },
    });
    expect(first.error()).toBe(denial);
    expect(second.error()).toBe(denial);

    first.onResult({
      stale: false,
      hasNext: false,
      operation: oldOperation,
      data: { viewer: { id: 'old' } },
    });
    expect(first.error()).toBe(denial);
    expect(second.error()).toBe(denial);

    const recoveryOperation = client.createRequestOperation(
      'query',
      createRequest(document, {}),
      first.requestContext()
    );
    first.onResult({
      stale: false,
      hasNext: false,
      operation: recoveryOperation,
      data: { viewer: { id: 'current' } },
      extensions: { __macroNormalizedCache: { source: 'live-network' } },
    });
    expect(first.error()).toBeUndefined();
    expect(second.error()).toBeUndefined();

    second.onResult({
      stale: false,
      hasNext: false,
      operation: deniedOperation,
      error: denial,
    });
    expect(first.error()).toBeUndefined();
  });

  it.each([
    'normalized-cache-hit',
    'affected-cache-reread',
    'normalized-cache-patch',
  ])('ignores %s results for denial and recovery', (source) => {
    const client = createClient({ url: 'http://test/graphql', exchanges: [] });
    const first = createQueryAuthorization(() => 'viewer:project', client);
    const second = createQueryAuthorization(() => 'viewer:project', client);
    const operation = client.createRequestOperation(
      'query',
      createRequest(document, {}),
      first.requestContext()
    );
    const denial = new CombinedError({ graphQLErrors: ['Forbidden'] });

    first.onResult({
      stale: false,
      hasNext: false,
      operation,
      error: denial,
      extensions: { __macroNormalizedCache: { source } },
    });
    expect(second.error()).toBeUndefined();

    second.onResult({ stale: false, hasNext: false, operation, error: denial });
    expect(first.error()).toBe(denial);
    const cacheOperation = client.createRequestOperation(
      'query',
      createRequest(document, {}),
      first.requestContext()
    );
    first.onResult({
      stale: false,
      hasNext: false,
      operation: cacheOperation,
      data: { viewer: { id: 'cached' } },
      extensions: { __macroNormalizedCache: { source } },
    });
    expect(first.error()).toBe(denial);
    expect(second.error()).toBe(denial);
  });

  it('isolates different scopes and clients', () => {
    const client = createClient({ url: 'http://test/graphql', exchanges: [] });
    const otherClient = createClient({
      url: 'http://test/graphql',
      exchanges: [],
    });
    const first = createQueryAuthorization(() => 'viewer:first', client);
    const otherScope = createQueryAuthorization(() => 'viewer:second', client);
    const otherSession = createQueryAuthorization(
      () => 'viewer:first',
      otherClient
    );
    const operation = client.createRequestOperation(
      'query',
      createRequest(document, {}),
      first.requestContext()
    );
    const denial = new CombinedError({ graphQLErrors: ['Forbidden'] });

    first.onResult({ stale: false, hasNext: false, operation, error: denial });
    expect(first.error()).toBe(denial);
    expect(otherScope.error()).toBeUndefined();
    expect(otherSession.error()).toBeUndefined();

    otherScope.onResult({
      stale: false,
      hasNext: false,
      operation,
      error: denial,
    });
    expect(otherScope.error()).toBeUndefined();
    const otherOperation = otherClient.createRequestOperation(
      'query',
      createRequest(document, {}),
      otherSession.requestContext()
    );
    otherSession.onResult({
      stale: false,
      hasNext: false,
      operation: otherOperation,
      data: { viewer: { id: 'current' } },
    });
    expect(first.error()).toBe(denial);
  });

  it('preserves independent mount-local authorization without a request context', () => {
    const first = createQueryAuthorization(() => 'batch');
    const second = createQueryAuthorization(() => 'batch');
    const client = createClient({ url: 'http://test/graphql', exchanges: [] });
    const operation = client.createRequestOperation(
      'query',
      createRequest(document, {})
    );
    const denial = new CombinedError({ graphQLErrors: ['Forbidden'] });

    first.onResult({ stale: false, hasNext: false, operation, error: denial });
    expect(first.error()).toBe(denial);
    expect(second.error()).toBeUndefined();

    first.onResult({
      stale: false,
      hasNext: false,
      operation,
      data: { viewer: { id: 'current' } },
    });
    expect(first.error()).toBeUndefined();
  });
});
