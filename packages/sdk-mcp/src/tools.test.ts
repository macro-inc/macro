import { describe, expect, test } from 'vitest';
import { catalog } from './generated/catalog';
import { buildTools, type Tool, type ToolGrouping } from './tools';

/** What MCP's `tools/list` sends for each tool. */
function listed(tools: readonly Tool[]) {
  return tools.map(
    ({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      annotations,
      inputSchema,
    })
  );
}

describe('buildTools', () => {
  for (const grouping of ['entity', 'method'] satisfies ToolGrouping[]) {
    test(`the ${grouping} tool list matches its snapshot`, async () => {
      await expect(
        `${JSON.stringify(listed(buildTools(catalog, grouping)), null, 2)}\n`
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
