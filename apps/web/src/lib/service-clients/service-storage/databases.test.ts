import {
  type FetchWithTokenInit,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabaseQuery } from './database-queries';
import { databasesClient } from './databases';

vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));
const fetch = vi.mocked(fetchWithToken);

/** The service answers `status` with `body`; the client's own handler words it. */
function answer(status: number, body: string) {
  fetch.mockImplementation(
    async (_input: RequestInfo, init?: FetchWithTokenInit<string>) => {
      const handler = init?.errorResponseHandler;
      if (!handler) throw new Error('the client must word its own failures');
      return err([await handler(new Response(body, { status }))]);
    }
  );
}

beforeEach(() => {
  fetch.mockReset();
});

describe('databases client failures', () => {
  it('names a refused schema change INVALID_SCHEMA with the service’s message', async () => {
    answer(400, JSON.stringify({ message: 'A column named Status exists.' }));

    const created = await databasesClient.create({ name: 'Tasks' });

    expect(created._unsafeUnwrapErr()).toEqual([
      { code: 'INVALID_SCHEMA', message: 'A column named Status exists.' },
    ]);
  });

  it('keeps the transport’s codes for missing, forbidden and conflicting requests', async () => {
    answer(404, JSON.stringify({ message: 'not found' }));
    expect(
      (await databasesClient.get({ id: 'db' }))._unsafeUnwrapErr()
    ).toEqual([{ code: 'NOT_FOUND', message: 'not found' }]);

    answer(403, JSON.stringify({ message: 'unauthorized' }));
    expect(
      (await databasesClient.get({ id: 'db' }))._unsafeUnwrapErr()
    ).toEqual([{ code: 'FORBIDDEN', message: 'unauthorized' }]);

    answer(500, 'Internal server error');
    expect((await databasesClient.list())._unsafeUnwrapErr()).toEqual([
      { code: 'SERVER_ERROR', message: 'Internal server error' },
    ]);

    answer(502, 'Bad gateway');
    expect((await databasesClient.list())._unsafeUnwrapErr()).toEqual([
      { code: 'HTTP_ERROR', message: 'Bad gateway' },
    ]);
  });

  it('reads a 400 on a read route as an HTTP error, not a refusal', async () => {
    answer(400, '');

    expect(
      (
        await databasesClient.columnCasts({
          id: 'db',
          tableId: 'table',
          columnId: 'column',
        })
      )._unsafeUnwrapErr()
    ).toEqual([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 400' }]);
  });

  it('carries the op, row and column an /ops refusal names', async () => {
    answer(
      400,
      JSON.stringify({
        message: 'op 0, row 1, column col-status: "Done" is not an option',
        op: 0,
        row: 1,
        column: 'col-status',
      })
    );

    const applied = await databasesClient.applyOps({
      id: 'db',
      request: { ops: [] },
    });

    expect(applied._unsafeUnwrapErr()).toEqual([
      {
        code: 'INVALID_OP',
        message: 'op 0, row 1, column col-status: "Done" is not an option',
        refusal: {
          message: 'op 0, row 1, column col-status: "Done" is not an option',
          op: 0,
          row: 1,
          column: 'col-status',
          taken: null,
        },
      },
    ]);
  });

  it('names the id a refused batch found already taken', async () => {
    answer(
      400,
      JSON.stringify({
        message: 'op 0: table 0199a3c4-0000-7000-8000-000000000001 exists',
        op: 0,
        row: null,
        column: null,
        taken: { kind: 'table', id: '0199a3c4-0000-7000-8000-000000000001' },
      })
    );

    const applied = await databasesClient.applyOps({
      id: 'db',
      request: {
        ops: [
          {
            kind: 'table',
            table: '0199a3c4-0000-7000-8000-000000000001',
            change: { kind: 'create', name: 'Tasks' },
          },
        ],
      },
    });

    expect(applied._unsafeUnwrapErr()).toEqual([
      {
        code: 'INVALID_OP',
        message: 'op 0: table 0199a3c4-0000-7000-8000-000000000001 exists',
        refusal: {
          message: 'op 0: table 0199a3c4-0000-7000-8000-000000000001 exists',
          op: 0,
          row: null,
          column: null,
          taken: { kind: 'table', id: '0199a3c4-0000-7000-8000-000000000001' },
        },
      },
    ]);
  });

  it('names a view id a refused batch found already taken', async () => {
    answer(
      400,
      JSON.stringify({
        message: 'op 0: view 0199a3c4-0000-7000-8000-000000000002 exists',
        op: 0,
        row: null,
        column: null,
        taken: { kind: 'view', id: '0199a3c4-0000-7000-8000-000000000002' },
      })
    );

    const applied = await databasesClient.applyOps({
      id: 'db',
      request: {
        ops: [
          {
            kind: 'view',
            table: 'table',
            view: '0199a3c4-0000-7000-8000-000000000002',
            change: {
              kind: 'create',
              view: { name: 'Board', layout: { kind: 'table', columns: [] } },
            },
          },
        ],
      },
    });

    expect(applied._unsafeUnwrapErr()).toEqual([
      {
        code: 'INVALID_OP',
        message: 'op 0: view 0199a3c4-0000-7000-8000-000000000002 exists',
        refusal: {
          message: 'op 0: view 0199a3c4-0000-7000-8000-000000000002 exists',
          op: 0,
          row: null,
          column: null,
          taken: { kind: 'view', id: '0199a3c4-0000-7000-8000-000000000002' },
        },
      },
    ]);
  });

  it('sends the base versions with the ops', async () => {
    fetch.mockResolvedValue(ok({ results: [] }));

    await databasesClient.applyOps({
      id: 'db',
      request: {
        ops: [
          {
            kind: 'column',
            table: 'table',
            column: 'column',
            change: { kind: 'delete' },
          },
        ],
        baseVersions: { table: 7 },
      },
    });

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/databases\/db\/ops$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ops: [
            {
              kind: 'column',
              table: 'table',
              column: 'column',
              change: { kind: 'delete' },
            },
          ],
          baseVersions: { table: 7 },
        }),
      })
    );
  });

  it('leaves the refusal empty when the body is not an op refusal', async () => {
    answer(400, JSON.stringify({ message: 'op 0: the table has no rows' }));

    const applied = await databasesClient.applyOps({
      id: 'db',
      request: { ops: [] },
    });

    expect(applied._unsafeUnwrapErr()).toEqual([
      {
        code: 'INVALID_OP',
        message: 'op 0: the table has no rows',
        refusal: null,
      },
    ]);
  });

  it('gives an /ops failure that is not a refusal no refusal', async () => {
    answer(
      409,
      JSON.stringify({
        message: 'The table changed.',
        op: 0,
        row: 1,
        column: 'col-status',
      })
    );

    const applied = await databasesClient.applyOps({
      id: 'db',
      request: { ops: [] },
    });

    expect(applied._unsafeUnwrapErr()).toEqual([
      { code: 'CONFLICT', message: 'The table changed.', refusal: null },
    ]);
  });

  it('passes a success through untouched', async () => {
    fetch.mockResolvedValue(ok({ results: [] }));

    const applied = await databasesClient.applyOps({
      id: 'db',
      request: { ops: [] },
    });

    expect(applied._unsafeUnwrap()).toEqual({ results: [] });
  });
});

describe('saved query failures', () => {
  it('names each refusal by what the route says it means', async () => {
    answer(404, JSON.stringify({ message: 'not found' }));
    expect((await getDatabaseQuery('query'))._unsafeUnwrapErr()).toEqual([
      { code: 'NOT_FOUND', message: 'not found' },
    ]);

    answer(401, JSON.stringify({ message: 'unauthorized' }));
    expect((await getDatabaseQuery('query'))._unsafeUnwrapErr()).toEqual([
      { code: 'UNAUTHORIZED', message: 'unauthorized' },
    ]);

    answer(422, JSON.stringify({ message: 'query is too long' }));
    expect((await getDatabaseQuery('query'))._unsafeUnwrapErr()).toEqual([
      { code: 'QUERY_TOO_LONG', message: 'query is too long' },
    ]);

    answer(500, JSON.stringify({ message: 'internal server error' }));
    expect((await getDatabaseQuery('query'))._unsafeUnwrapErr()).toEqual([
      { code: 'SERVER_ERROR', message: 'internal server error' },
    ]);
  });
});
