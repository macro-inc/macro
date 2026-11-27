import { afterEach, expect, it } from 'vitest';
import {
  type HeadlessCacheRuntime,
  installHeadlessCacheRuntime,
} from './runtime';

const QUERY = 'query HeadlessSmoke { user { __typename id } }';

let runtime: HeadlessCacheRuntime | undefined;

afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

it('runs the real engine through the page host, coordinator and engine worker', async () => {
  runtime = await installHeadlessCacheRuntime();
  const host = runtime.openHost('headless-smoke');
  const authority = await host.authority?.current();
  expect(authority).toBeDefined();
  const sqlBefore = runtime.engine.sqlCounters();
  const callsBefore = runtime.engine.log.mark();

  const written = await host.writeQuery({
    generation: authority?.generation ?? '',
    query: QUERY,
    operationName: 'HeadlessSmoke',
    data: { user: { __typename: 'GraphqlUser', id: 'viewer' } },
    identity: 'viewer',
  });
  expect(written.revisionAdvanced).toBe(true);

  const read = await host.readQuery({
    query: QUERY,
    operationName: 'HeadlessSmoke',
  });
  expect(read).toEqual({
    kind: 'hit',
    data: { user: { __typename: 'GraphqlUser', id: 'viewer' } },
  });

  const sqlAfter = runtime.engine.sqlCounters();
  expect(sqlAfter.statements).toBeGreaterThan(sqlBefore.statements);
  expect(sqlAfter.rows).toBeGreaterThan(sqlBefore.rows);
  expect(Object.keys(runtime.engine.log.countsSince(callsBefore))).not.toEqual(
    []
  );
  expect(runtime.opfs.counters.writes).toBeGreaterThan(0);
  expect(runtime.initializationErrors).toEqual([]);
});
