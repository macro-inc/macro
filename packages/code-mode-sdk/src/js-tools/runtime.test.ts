import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogTool } from './catalog';
import { makeRuntime, type ToolInput } from './runtime';

function tool(name: string): CatalogTool {
  return {
    path: ['storage', name],
    service: 'storage',
    operationId: name,
    client: 'storage',
    method: name,
    httpMethod: 'POST',
    route: `/${name}`,
    rivals: [],
    description: `Tasks · create · ${name}`,
    input: {
      type: 'object',
      properties: { body: { $ref: '#/$defs/Body' } },
    },
    output: { type: 'object' },
  };
}

const CATALOG: Catalog = {
  tools: [tool('create_task_handler'), tool('delete_document')],
  defs: {
    storage: {
      Body: { type: 'object', properties: { taskName: { type: 'string' } } },
    },
  },
  skipped: [],
};

const LIMITS = { timeoutMs: 5000, maxToolCalls: 4, maxOutputBytes: 64 * 1024 };

describe('JS tools runtime', () => {
  it('sends an admitted call with its path, query and body, and returns its data', async () => {
    const calls: [string, ToolInput][] = [];
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: async (target, input) => {
        calls.push([target.operationId, input]);
        return { documentId: 'task-1' };
      },
      limits: LIMITS,
    });
    const result = await runtime.execute(
      'console.log("creating"); const t = await tools.storage.create_task_handler({ body: { taskName: "x" } }); return { id: t.documentId, session: context.sessionId }',
      { context: { sessionId: 'session-1' } }
    );
    expect(result).toMatchObject({
      ok: true,
      value: { id: 'task-1', session: 'session-1' },
      logs: ['creating'],
    });
    expect(calls).toEqual([
      [
        'create_task_handler',
        { path: undefined, query: undefined, body: { taskName: 'x' } },
      ],
    ]);
  });

  it('never sends a call outside the admitted set, though search still lists it', async () => {
    const calls: string[] = [];
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: async (target) => {
        calls.push(target.operationId);
        return {};
      },
      limits: LIMITS,
    });
    const result = await runtime.execute(
      'const found = search("delete document").items.map((item) => item.path); try { await tools.storage.delete_document({}) } catch (error) { return { found, error: String(error) } }',
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        found: expect.arrayContaining(['tools.storage.delete_document']),
        error: expect.stringContaining(
          'tools.storage.delete_document is outside what this program was checked to call; it was not sent.'
        ),
      },
    });
    expect(calls).toEqual([]);
  });

  it('refuses options other than path, query and body before sending', async () => {
    const calls: string[] = [];
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: async (target) => {
        calls.push(target.operationId);
        return {};
      },
      limits: LIMITS,
    });
    const result = await runtime.execute(
      'try { await tools.storage.create_task_handler({ url: "/documents/delete", baseUrl: "https://elsewhere.example" }) } catch (error) { return String(error) }',
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      value: expect.stringContaining('"url", "baseUrl" is not one of them'),
    });
    expect(calls).toEqual([]);
  });

  it('refuses path parameters that would leave their route', async () => {
    const calls: string[] = [];
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: async (target) => {
        calls.push(target.operationId);
        return {};
      },
      limits: LIMITS,
    });
    for (const value of [
      '".."',
      '"."',
      '{ "../../email/admin?x=": 1 }',
      '["a", "b"]',
      'null',
    ]) {
      const result = await runtime.execute(
        `try { await tools.storage.create_task_handler({ path: { document_id: ${value} } }) } catch (error) { return String(error) }`,
        {}
      );
      expect(result, value).toMatchObject({
        ok: true,
        value: expect.stringContaining(
          'path.document_id must be a string, number or boolean naming one path segment.'
        ),
      });
    }
    expect(calls).toEqual([]);
  });

  it('gives a failed call to the program as a thrown error', async () => {
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: () => Promise.reject(new Error('HTTP 403: {"message":"no"}')),
      limits: LIMITS,
    });
    const result = await runtime.execute(
      'try { await tools.storage.create_task_handler({}) } catch (error) { return String(error) }',
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      value: expect.stringContaining('HTTP 403: {"message":"no"}'),
    });
  });

  it('stops at the tool-call limit', async () => {
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: async () => ({}),
      limits: { ...LIMITS, maxToolCalls: 2 },
    });
    const result = await runtime.execute(
      'for (let i = 0; i < 3; i++) await tools.storage.create_task_handler({}); return 1',
      {}
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'ToolCallLimitExceeded' },
    });
  });

  it("reads and calls the run's module through get and call, as copied data", async () => {
    const asked: [string, unknown, unknown[]][] = [];
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(['storage.create_task_handler']),
      call: async () => ({ documentId: 'task-1' }),
      module: {
        get: async (name) => {
          asked.push(['get', name, []]);
          return { greeting: 'hello' };
        },
        call: async (name, args) => {
          asked.push(['call', name, args]);
          if (name === 'fails') throw new Error('render failed');
          return `rendered ${JSON.stringify(args)}`;
        },
      },
      limits: LIMITS,
    });
    const result = await runtime.execute(
      'const task = await tools.storage.create_task_handler({ body: { taskName: "x" } }); const g = await get("greeting"); const r = await call("render", task, g, () => 1); let error; try { await call("fails") } catch (e) { error = String(e) } return { g, r, error, fetch: typeof fetch }',
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        g: { greeting: 'hello' },
        r: expect.stringContaining('task-1'),
        error: expect.stringContaining('render failed'),
        fetch: 'undefined',
      },
    });
    // A function argument never crosses: the interpreter leaves it out.
    expect(asked[1]?.[2]).toEqual([
      { documentId: 'task-1' },
      { greeting: 'hello' },
      undefined,
    ]);
  });

  it('has no get or call without a module', async () => {
    const runtime = makeRuntime({
      catalog: CATALOG,
      admitted: new Set(),
      call: async () => ({}),
      limits: LIMITS,
    });
    const result = await runtime.execute(
      'return [typeof get, typeof call]',
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      value: ['undefined', 'undefined'],
    });
  });
});
