import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { catalog, flagged } from './generated/catalog';
import { buildTools, type Tool, type ToolGrouping } from './tools';

/** `value` without `description` strings, with object keys sorted. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) => key !== 'description' || typeof item !== 'string'
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)])
  );
}

/**
 * What MCP's `tools/list` sends for each tool: its name, title and hints, the
 * operations it carries, and a hash of its input schema, so a schema change
 * shows as a changed hash without snapshotting every schema. Descriptions are
 * the SDK's TSDoc and would make every doc edit a snapshot update, so they
 * are left out of the hash too. One line per tool keeps diffs to the tools
 * that changed.
 */
function listed(tools: readonly Tool[]) {
  return tools.map(({ name, title, inputSchema, annotations, operations }) => ({
    name,
    title,
    annotations,
    operations: [...operations.keys()],
    schema: createHash('sha256')
      .update(JSON.stringify(canonical(inputSchema)))
      .digest('hex')
      .slice(0, 16),
  }));
}

describe('buildTools', () => {
  for (const grouping of ['entity', 'method'] satisfies ToolGrouping[]) {
    test(`the ${grouping} tool list matches its snapshot`, async () => {
      await expect(
        `[\n${listed(buildTools(catalog, grouping))
          .map((tool) => JSON.stringify(tool))
          .join(',\n')}\n]\n`
      ).toMatchFileSnapshot(`./__snapshots__/tools.${grouping}.json`);
    });
  }

  test('flagged methods are no tools: tool permissions stay out while their flag is off', () => {
    expect(flagged).toEqual({
      'enable-agent-permissions': [
        'Agent.tightenToolPermissions',
        'Agent.toolPermissions',
        'AgentSession.toolPermissions',
        'agents.toolPermissionCatalog',
      ],
    });
    const left = new Set(Object.values(flagged).flat());
    for (const grouping of ['entity', 'method'] satisfies ToolGrouping[])
      for (const tool of buildTools(catalog, grouping))
        for (const operation of tool.operations.keys())
          expect(left.has(operation), `${tool.name}: ${operation}`).toBe(false);
  });

  test('an entity tool holds one hint class and sets every hint', () => {
    const tools = buildTools(catalog, 'entity');
    const read = tools.find((tool) => tool.name === 'documents_read');
    const write = tools.find((tool) => tool.name === 'documents_write');
    const taskWrite = tools.find((tool) => tool.name === 'tasks_write');
    const create = buildTools(catalog, 'method').find(
      (tool) => tool.name === 'tasks-create'
    );
    const remove = tools.find((tool) => tool.name === 'documents_delete');

    expect(read?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    // Edits can overwrite, and a change reaches collaborators.
    expect(write?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    // A grouped task tool also edits templates, so the whole tool is destructive.
    expect([...(taskWrite?.operations.keys() ?? [])]).toEqual([
      'tasks.create',
      'TaskTemplate.update',
      'taskTemplates.create',
    ]);
    expect(taskWrite?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    // Only creating something new isn't destructive.
    expect([...(create?.operations.keys() ?? [])]).toEqual(['tasks.create']);
    expect(create?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(remove?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    for (const tool of tools)
      for (const operation of tool.operations.values())
        expect(`${operation.group}_${operation.hint}`).toBe(tool.name);
  });

  test('sending email is its own destructive, open-world tool, apart from deleting', () => {
    const tools = buildTools(catalog, 'entity');
    const send = tools.find((tool) => tool.name === 'email_send');
    const remove = tools.find((tool) => tool.name === 'email_delete');

    expect(send?.annotations).toEqual({
      title: 'email: send',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect([...(send?.operations.keys() ?? [])]).toContain('email.send');
    expect([...(remove?.operations.keys() ?? [])]).not.toContain('email.send');
  });

  test('both groupings offer every operation exactly once', () => {
    for (const grouping of ['entity', 'method'] satisfies ToolGrouping[]) {
      const offered = buildTools(catalog, grouping).flatMap((tool) => [
        ...tool.operations.keys(),
      ]);
      expect(offered.sort()).toEqual(
        catalog.operations.map((operation) => operation.name).sort()
      );
    }
  });
  test('descriptions name tools, not SDK namespaces or TSDoc links', () => {
    const tools = buildTools(catalog, 'entity');
    const text = JSON.stringify(
      tools.map(({ description, inputSchema }) => ({
        description,
        inputSchema,
      }))
    );
    expect(text).not.toMatch(/\{@link/);
    // `macro.web` alone is code mode's spelling; MCP gets `the web_* tools`.
    expect(text).not.toMatch(/`macro\.[a-z][A-Za-z]*`/);
    expect(
      tools.find((tool) => tool.name === 'ai_read')?.description
    ).toContain('the `images_*` tools');
  });

  test('every tool name says what it covers', () => {
    const names = buildTools(catalog, 'entity').map((tool) => tool.name);
    // Grab-bag and jargon groups the review called unclear.
    for (const unclear of ['core', 'foreign', 'harnesses'])
      expect(names.filter((name) => name.startsWith(`${unclear}_`))).toEqual(
        []
      );
    expect(names).toEqual(
      expect.arrayContaining([
        'account_managers_read',
        'comments_write',
        'linked_items_read',
        'agent_hosts_read',
        'web_read',
        'referrals_send',
        'teams_send',
      ])
    );
  });
});
