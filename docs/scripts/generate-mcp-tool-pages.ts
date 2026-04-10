import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

type ToolSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

type ToolSchemas = {
  schemas: ToolSchema[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(docsDir, '..');
const rustCloudStorageDir = path.join(repoRoot, 'rust', 'cloud-storage');
const aiToolsDir = path.join(rustCloudStorageDir, 'ai_tools');
const toolJsonPath = path.join(aiToolsDir, 'schemas', 'tools.json');
const outputDir = path.join(docsDir, 'AI', 'mcp', 'tools');
const navOutputPath = path.join(docsDir, 'config', 'tool-pages.json');

function slugifyToolName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function renderParamsTable(schema: Record<string, unknown>): string {
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties || Object.keys(properties).length === 0) return '';

  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : []
  );

  const rows = Object.entries(properties).map(([name, prop]) => {
    const typeVal = Array.isArray(prop.type)
      ? prop.type.filter((t: string) => t !== 'null').join('')
      : (prop.type as string) ?? '';
    const req = required.has(name) ? 'Yes' : 'No';
    const desc = ((prop.description as string) ?? '').replaceAll('\n', ' ').replaceAll('|', '\\|');
    return `| \`${name}\` | ${typeVal} | ${req} | ${desc} |`;
  });

  return `| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
${rows.join('\n')}`;
}

async function buildAndRunSchemaGenerator() {
  await $`cd ${rustCloudStorageDir} && SQLX_OFFLINE=true cargo build --bin gen_tool_schemas`;
  await $`rm -rf ${path.join(aiToolsDir, 'schemas')}`.quiet();
  const binaryPath = path.join(
    rustCloudStorageDir,
    'target',
    'debug',
    'gen_tool_schemas'
  );
  await $`cd ${aiToolsDir} && ${binaryPath}`;
}

async function loadSchemas(): Promise<ToolSchemas> {
  await buildAndRunSchemaGenerator();
  const raw = await readFile(toolJsonPath, 'utf8');
  return JSON.parse(raw) as ToolSchemas;
}

async function resetGeneratedPages() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
}

function renderToolPage(tool: ToolSchema) {
  const slug = slugifyToolName(tool.name);
  const description =
    tool.description ?? 'Generated from the Macro Rust tool registry.';
  const paramsTable = renderParamsTable(tool.inputSchema);

  return {
    slug,
    body: `---
title: ${tool.name}
description: "${description.replaceAll('\n', ' ').replaceAll('"', '\\"')}"
---

# ${tool.name}

${description}
${paramsTable ? `\n## Parameters\n\n${paramsTable}\n` : ''}`,
  };
}

async function writeIndexPage(toolPages: Array<{ slug: string; name: string }>) {
  const page = `---
title: Tool Reference
description: Generated reference pages for Macro MCP tools.
---

# Tool Reference

These pages are generated from Macro's Rust MCP tool registry.

## Tools

${toolPages.map((tool) => `- [${tool.name}](/AI/mcp/tools/${tool.slug})`).join('\n')}
`;
  await writeFile(path.join(outputDir, 'index.mdx'), page);
}

async function main() {
  const toolSchemas = await loadSchemas();
  const tools = [...toolSchemas.schemas].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  await resetGeneratedPages();

  const navPages = ['AI/mcp/tools/index'];
  const toolPages: Array<{ slug: string; name: string }> = [];

  for (const tool of tools) {
    const page = renderToolPage(tool);
    const pagePath = path.join(outputDir, `${page.slug}.mdx`);
    await writeFile(pagePath, page.body);
    navPages.push(`AI/mcp/tools/${page.slug}`);
    toolPages.push({ slug: page.slug, name: tool.name });
  }

  await writeIndexPage(toolPages);
  await writeFile(`${navOutputPath}`, `${JSON.stringify(navPages, null, 2)}\n`);
}

await main();
