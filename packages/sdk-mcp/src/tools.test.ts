import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { catalog } from './generated/catalog';
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

  test('an entity tool holds one hint class and sets every hint', () => {
    const tools = buildTools(catalog, 'entity');
    const write = tools.find((tool) => tool.name === 'documents_write');
    const remove = tools.find((tool) => tool.name === 'documents_delete');

    expect(write?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(remove?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    for (const tool of tools)
      for (const operation of tool.operations.values())
        expect(`${operation.group}_${operation.hint}`).toBe(tool.name);
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
});
