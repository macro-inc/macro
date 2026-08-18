import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

type JsonSchema = Record<string, unknown>;

/** An entry in `tools`: the tool name plus the `$defs` keys for its schemas. */
type ToolEntry = {
  name: string;
  input: string;
  output: string;
};

/** Shape of `crates/ai_tools/schemas/tools.json`. */
type ToolSchemaFile = {
  $defs: Record<string, JsonSchema>;
  tools: ToolEntry[];
};

/** A tool with its `$defs` reference resolved to the actual input schema. */
type ResolvedTool = {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(docsDir, '../..');
const aiToolsDir = path.join(repoRoot, 'crates', 'ai_tools');
const toolJsonPath = path.join(aiToolsDir, 'schemas', 'tools.json');
const outputDir = path.join(docsDir, 'AI', 'mcp', 'tools');
const navOutputPath = path.join(docsDir, 'config', 'tool-pages.json');
const docsJsonPath = path.join(docsDir, 'docs.json');
/** Nav group in `docs.json` whose page list this script owns. */
const NAV_GROUP = 'Tool Reference';

function slugifyToolName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function refName(ref: string) {
  return ref.split('/').pop() ?? ref;
}

function isNullSchema(schema: JsonSchema) {
  return schema.type === 'null';
}

/**
 * The string variants of a Rust enum, in either encoding schemars emits: a
 * plain `enum` list, or a `oneOf`/`anyOf` of `const`s when variants are
 * individually documented.
 */
function constUnion(schema: JsonSchema): string[] | undefined {
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v) => typeof v === 'string') as string[];
    if (values.length > 0 && values.length === schema.enum.length) return values;
  }

  const variants = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined;
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  const consts = variants
    .filter((v) => !isNullSchema(v))
    .map((v) => v.const)
    .filter((c) => typeof c === 'string') as string[];
  const nonNull = variants.filter((v) => !isNullSchema(v));
  return consts.length === nonNull.length ? consts : undefined;
}

/**
 * Render a human-readable type for a property. Resolves `$ref` into `$defs`,
 * unwraps the `allOf`/`anyOf` wrappers schemars emits for defaults and
 * `Option<T>`, and expands Rust enums into their literal values.
 */
function describeType(
  schema: JsonSchema | undefined,
  defs: Record<string, JsonSchema>,
  depth = 0
): string {
  if (!schema || depth > 4) return 'any';

  if (typeof schema.$ref === 'string') {
    const name = refName(schema.$ref);
    const target = defs[name];
    const consts = target ? constUnion(target) : undefined;
    if (consts) return consts.map((c) => `\`"${c}"\``).join(' \\| ');
    return name;
  }

  const consts = constUnion(schema);
  if (consts) return consts.map((c) => `\`"${c}"\``).join(' \\| ');

  const wrapper = (schema.allOf ?? schema.anyOf ?? schema.oneOf) as
    | JsonSchema[]
    | undefined;
  if (Array.isArray(wrapper)) {
    const parts = wrapper
      .filter((entry) => !isNullSchema(entry))
      .filter((entry) => entry.$ref !== undefined || entry.type !== undefined)
      .map((entry) => describeType(entry, defs, depth + 1));
    const unique = [...new Set(parts)].filter((p) => p !== 'any');
    if (unique.length > 0) return unique.join(' \\| ');
  }

  const types = Array.isArray(schema.type)
    ? (schema.type as string[]).filter((t) => t !== 'null')
    : typeof schema.type === 'string'
      ? [schema.type as string]
      : [];

  if (types.includes('array')) {
    const items = schema.items as JsonSchema | undefined;
    const label = describeType(items, defs, depth + 1);
    // Parenthesize a union so `("a" | "b")[]` doesn't read as `"a" | ("b"[])`.
    return label.includes('\\|') ? `(${label})[]` : `${label}[]`;
  }
  if (types.length > 0) return types.join(' \\| ');
  if (schema.properties) return 'object';
  return 'any';
}

/** Property description, falling back to the description on a `$ref` target. */
function describeProp(
  schema: JsonSchema,
  defs: Record<string, JsonSchema>
): string {
  const own = schema.description;
  if (typeof own === 'string') return own;
  if (typeof schema.$ref === 'string') {
    const target = defs[refName(schema.$ref)];
    if (typeof target?.description === 'string') return target.description;
  }
  const wrapper = (schema.allOf ?? schema.anyOf) as JsonSchema[] | undefined;
  if (Array.isArray(wrapper)) {
    for (const entry of wrapper) {
      if (typeof entry.$ref === 'string') {
        const target = defs[refName(entry.$ref)];
        if (typeof target?.description === 'string') return target.description;
      }
    }
  }
  return '';
}

function escapeCell(text: string) {
  return text.replaceAll('\n', ' ').replaceAll('|', '\\|').trim();
}

function renderParamsTable(
  schema: JsonSchema,
  defs: Record<string, JsonSchema>
): string {
  const properties = schema.properties as
    | Record<string, JsonSchema>
    | undefined;
  if (!properties || Object.keys(properties).length === 0) return '';

  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : []
  );

  const rows = Object.entries(properties).map(([name, prop]) => {
    const type = describeType(prop, defs);
    const req = required.has(name) ? 'Yes' : 'No';
    const desc = escapeCell(describeProp(prop, defs));
    return `| \`${name}\` | ${type} | ${req} | ${desc} |`;
  });

  return `| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
${rows.join('\n')}`;
}

async function buildAndRunSchemaGenerator() {
  await $`cd ${repoRoot} && SQLX_OFFLINE=true cargo build --bin gen_tool_schemas`;
  await $`rm -rf ${path.join(aiToolsDir, 'schemas')}`.quiet();
  const binaryPath = path.join(repoRoot, 'target', 'debug', 'gen_tool_schemas');
  await $`cd ${aiToolsDir} && ${binaryPath}`;
}

async function loadSchemas(): Promise<ToolSchemaFile> {
  await buildAndRunSchemaGenerator();
  const raw = await readFile(toolJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ToolSchemaFile>;
  if (!Array.isArray(parsed.tools) || !parsed.$defs) {
    throw new Error(
      `${toolJsonPath} is not in the expected { $defs, tools } shape — the Rust schema format changed.`
    );
  }
  return parsed as ToolSchemaFile;
}

/** Join each tool entry to its input schema in `$defs`. */
function resolveTools(file: ToolSchemaFile): ResolvedTool[] {
  return file.tools.map((tool) => {
    const inputSchema = file.$defs[tool.input];
    if (!inputSchema) {
      throw new Error(
        `tool ${tool.name} references missing input schema $defs/${tool.input}`
      );
    }
    const description = inputSchema.description;
    return {
      name: tool.name,
      description: typeof description === 'string' ? description : undefined,
      inputSchema,
    };
  });
}

async function resetGeneratedPages() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
}

function renderToolPage(tool: ResolvedTool, defs: Record<string, JsonSchema>) {
  const slug = slugifyToolName(tool.name);
  const description =
    tool.description ?? 'Generated from the Macro Rust tool registry.';
  const paramsTable = renderParamsTable(tool.inputSchema, defs);

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

async function writeIndexPage(
  toolPages: Array<{ slug: string; name: string }>
) {
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

/**
 * Replace the `pages` of the `Tool Reference` nav group in `docs.json`.
 * Mintlify does not resolve `$ref` in `docs.json`, so the page list has to be
 * inlined there — this keeps that copy in sync instead of hand-maintained.
 */
async function writeNavigation(navPages: string[]) {
  const raw = await readFile(docsJsonPath, 'utf8');
  const docsJson = JSON.parse(raw) as unknown;

  let patched = false;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.group === NAV_GROUP && Array.isArray(obj.pages)) {
      obj.pages = navPages;
      patched = true;
      return;
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(docsJson);

  if (!patched) {
    throw new Error(
      `no "${NAV_GROUP}" nav group with a pages array found in ${docsJsonPath} — restore it or update NAV_GROUP.`
    );
  }

  await writeFile(docsJsonPath, `${JSON.stringify(docsJson, null, 2)}\n`);
}

async function main() {
  const file = await loadSchemas();
  const tools = resolveTools(file).sort((a, b) => a.name.localeCompare(b.name));

  await resetGeneratedPages();

  const navPages = ['AI/mcp/tools/index'];
  const toolPages: Array<{ slug: string; name: string }> = [];

  for (const tool of tools) {
    const page = renderToolPage(tool, file.$defs);
    const pagePath = path.join(outputDir, `${page.slug}.mdx`);
    await writeFile(pagePath, page.body);
    navPages.push(`AI/mcp/tools/${page.slug}`);
    toolPages.push({ slug: page.slug, name: tool.name });
  }

  await writeIndexPage(toolPages);
  await writeFile(`${navOutputPath}`, `${JSON.stringify(navPages, null, 2)}\n`);
  await writeNavigation(navPages);
  console.log(`Generated ${tools.length} tool pages in ${outputDir}`);
}

await main();
