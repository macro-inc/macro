import { describe, expect, test } from 'bun:test';
import { operationsByName, readOperations } from './operations';
import { parseTarget, Router, type RouterUpstream } from './router';

const OPERATIONS = operationsByName(
  await readOperations(`${import.meta.dir}/../fixtures/operations.json`)
);

// storage and properties share one host, as they do behind the gateway.
const SHARED: Record<string, RouterUpstream> = {
  storage: { origin: 'http://upstream.test', basePath: ['dss'] },
  properties: { origin: 'http://upstream.test', basePath: ['dss'] },
};

const ROUTER = new Router(OPERATIONS.values(), (service) =>
  Object.hasOwn(SHARED, service) ? SHARED[service] : undefined
);

function route(method: string, target: string, router = ROUTER) {
  const parsed = parseTarget(target);
  if (!parsed.ok) throw new Error(`refused ${target}: ${parsed.reason}`);
  return router.match(parsed.target, method)?.name;
}

describe('Router.match', () => {
  test.each([
    ['GET', '/api/storage/documents/d1', 'storage.get_document'],
    ['DELETE', '/api/storage/documents/d1', 'storage.delete_document'],
    ['POST', '/api/storage/documents', 'storage.create_document'],
    ['POST', '/api/storage/documents/d1/edit', 'storage.edit_document'],
    ['GET', '/api/storage/documents/d1/comments/c1', 'storage.get_comment'],
    ['GET', '/api/cognition/import/state', 'cognition.get_import_state'],
    ['GET', '/api/cognition/onboarding', 'cognition.get_onboarding_state'],
    ['GET', '/api/static-files/api/file/f1', 'static-files.get_file'],
    ['POST', '/api/email/email/messages/m1/send', 'email.send_message'],
    // The query plays no part in matching.
    [
      'GET',
      '/api/storage/documents/d1?method=DELETE&_method=DELETE',
      'storage.get_document',
    ],
  ])('%s %s is %s', (method, target, name) => {
    expect(route(method, target)).toBe(name);
  });

  test('a literal segment beats a parameter', () => {
    expect(route('GET', '/api/storage/documents/search')).toBe(
      'storage.search_documents'
    );
    expect(route('GET', '/api/storage/documents/search/recent')).toBe(
      'storage.list_recent_searches'
    );
  });

  test('a path with no route under the literal falls back to the parameter', () => {
    // /documents/search/edit has no literal route, so `search` is a document id.
    expect(route('POST', '/api/storage/documents/search/edit')).toBe(
      'storage.edit_document'
    );
  });

  test('a method the winning path lacks never falls back to a parameter route', () => {
    // DELETE /documents/{document_id} exists, but /documents/search wins the
    // path and has no DELETE: the service would answer 405, not delete
    // the document "search".
    expect(route('DELETE', '/api/storage/documents/search')).toBeUndefined();
  });

  test('services on one host are matched together', () => {
    // On the shared host storage's literal /properties/report wins, so the
    // properties operation can't be named for it.
    expect(route('GET', '/api/properties/properties/report')).toBeUndefined();
    expect(route('GET', '/api/storage/properties/report')).toBe(
      'storage.get_property_report'
    );
    expect(route('GET', '/api/properties/properties/p1')).toBe(
      'properties.get_definition'
    );

    // With properties on its own host, /properties/report is its parameter.
    const apart = new Router(OPERATIONS.values(), () => undefined);
    expect(route('GET', '/api/properties/properties/report', apart)).toBe(
      'properties.get_definition'
    );
  });

  test.each([
    ['PUT', '/api/storage/documents'],
    ['GET', '/api/storage/documents'],
    ['get', '/api/storage/documents/d1'],
    ['Get', '/api/storage/documents/d1'],
    ['HEAD', '/api/storage/documents/d1'],
    ['OPTIONS', '/api/storage/documents/d1'],
    ['GET', '/api/storage/Documents/d1'],
    ['GET', '/api/Storage/documents/d1'],
    ['GET', '/api/storage/documents/d1/edit'],
    ['GET', '/api/storage/nothing'],
    ['GET', '/api/nothing/documents/d1'],
    ['GET', '/api/__proto__/documents/d1'],
    ['GET', '/api/constructor/documents/d1'],
    ['GET', '/api/hasOwnProperty/x'],
    ['GET', '/api/storage/__proto__'],
    ['GET', '/api/storage/constructor'],
    ['GET', '/api/storage/toString'],
    // A route of another service on another host.
    ['GET', '/api/storage/import/state'],
    ['GET', '/api/storage/api/file/f1'],
  ])('%s %s matches nothing', (method, target) => {
    expect(route(method, target)).toBeUndefined();
  });

  test('an inherited name in a parameter position is just a value', () => {
    expect(route('GET', '/api/storage/documents/__proto__')).toBe(
      'storage.get_document'
    );
  });

  test('two operations of one service on the same method and path fail', () => {
    const first = OPERATIONS.get('storage.get_document');
    if (!first) throw new Error('fixture lacks storage.get_document');

    expect(
      () =>
        new Router(
          [
            first,
            {
              ...first,
              name: 'storage.read_document',
              operationId: 'read_document',
              path: '/documents/{id}',
            },
          ],
          () => undefined
        )
    ).toThrow('both route GET');
  });

  test('a template segment that is not a whole parameter fails', () => {
    const first = OPERATIONS.get('storage.get_document');
    if (!first) throw new Error('fixture lacks storage.get_document');

    expect(
      () =>
        new Router(
          [{ ...first, path: '/documents/{document_id}.json' }],
          () => undefined
        )
    ).toThrow('neither a literal nor a whole {parameter}');
  });
});

describe('parseTarget', () => {
  test('splits the service, decoded segments, raw path and raw query', () => {
    expect(
      parseTarget('/api/storage/documents/d%201/%C3%A9?q=a%2Fb&x=1;y')
    ).toEqual({
      ok: true,
      target: {
        service: 'storage',
        segments: ['documents', 'd 1', 'é'],
        path: '/documents/d%201/%C3%A9',
        query: '?q=a%2Fb&x=1;y',
      },
    });
  });

  test.each([
    ['/api/storage/documents/d1/', 'empty path segment'],
    ['/api/storage//documents/d1', 'empty path segment'],
    ['/api//storage/documents/d1', 'empty path segment'],
    ['/api/storage/', 'empty path segment'],
    ['/api/storage', 'no path after the service'],
    ['/api/', 'no path after the service'],
    ['/api/storage/documents/../documents/search', 'dot segment'],
    ['/api/storage/documents/./d1', 'dot segment'],
    ['/api/storage/documents/..', 'dot segment'],
    ['/api/../v1/executions', 'dot segment'],
    ['/api/storage/documents/%2e%2e/x', 'encoded unreserved character'],
    ['/api/storage/documents/.%2E', 'encoded unreserved character'],
    ['/api/storage/documents/a%2Fb', 'encoded slash or backslash'],
    ['/api/storage/documents/a%2fb', 'encoded slash or backslash'],
    ['/api/storage/documents/a%5Cb', 'encoded slash or backslash'],
    ['/api/storage/documents/a%5cb', 'encoded slash or backslash'],
    ['/api/storage/documents/a%252Fb', 'encoded percent sign'],
    ['/api/storage/documents/%73earch', 'encoded unreserved character'],
    ['/api/st%6Frage/documents/d1', 'encoded unreserved character'],
    ['/api/storage/documents/a%00', 'encoded control character'],
    ['/api/storage/documents/a%0D%0Ax', 'encoded control character'],
    ['/api/storage/documents/a%7F', 'encoded control character'],
    ['/api/storage/documents/a%zz', 'malformed percent-encoding'],
    ['/api/storage/documents/a%4', 'malformed percent-encoding'],
    ['/api/storage/documents/a%', 'malformed percent-encoding'],
    ['/api/storage/documents/d1?x=%zz', 'malformed percent-encoding'],
    ['/api/storage/documents/a%C3', 'percent-encoding is not UTF-8'],
    ['/api/storage/documents/a\\b', 'character not allowed in path'],
    ['/api/storage/documents/a b', 'character not allowed in path'],
    ['/api/storage/documents/é', 'character not allowed in path'],
    ['/api/storage/documents/search;x', 'character not allowed in path'],
    ['/api/storage/documents/{id}', 'character not allowed in path'],
    ['/api/storage/documents/a"b', 'character not allowed in path'],
    ['/api/storage/documents/a|b', 'character not allowed in path'],
    ['/api/storage/documents/a[b]', 'character not allowed in path'],
    ['/api/storage/documents/d1?x=a b', 'character not allowed in query'],
    ['/api/storage/documents/d1?x="', 'character not allowed in query'],
    ["/api/storage/documents/d1?x='", 'character not allowed in query'],
    ['/api/storage/documents/d1#x', 'fragment in target'],
    [
      'http://upstream.test/api/storage/documents/d1',
      'target must start with /api/',
    ],
    ['//evil.test/api/storage/documents/d1', 'target must start with /api/'],
    ['*', 'target must start with /api/'],
    ['/API/storage/documents/d1', 'target must start with /api/'],
    ['/apix/storage/documents/d1', 'target must start with /api/'],
    ['api/storage/documents/d1', 'target must start with /api/'],
  ])('refuses %s (%s)', (target, reason) => {
    expect(parseTarget(target)).toEqual({ ok: false, reason });
  });
});

describe('the real operation table', async () => {
  const real = operationsByName(
    await readOperations(`${import.meta.dir}/../../spec/operations.json`)
  );

  // storage, search and properties share one host behind the gateway.
  const dss: RouterUpstream = {
    origin: 'http://gateway.test',
    basePath: ['dss'],
  };
  const sharedHost = (service: string): RouterUpstream =>
    ['storage', 'search', 'properties'].includes(service)
      ? dss
      : { origin: 'http://gateway.test', basePath: [service] };

  test.each([
    ['each service alone', () => undefined],
    ['services on one gateway', sharedHost],
  ])('every operation routes to itself with %s', (_label, upstreamOf) => {
    const router = new Router(real.values(), upstreamOf);
    const misrouted: string[] = [];

    for (const operation of real.values()) {
      const path = operation.path.replace(/\{[^}]+\}/g, 'v1');
      const parsed = parseTarget(`/api/${operation.service}${path}`);
      const matched = parsed.ok
        ? router.match(parsed.target, operation.method)?.name
        : parsed.reason;
      if (matched !== operation.name)
        misrouted.push(`${operation.name} -> ${matched}`);
    }

    expect(real.size).toBeGreaterThan(900);
    expect(misrouted).toEqual([]);
  });
});
