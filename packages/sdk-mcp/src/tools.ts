import { match } from 'ts-pattern';
import type { Catalog, HintClass, Operation } from './catalog';
import { type JsonSchema, JsonSchemaWriter } from './schema';

/**
 * How operations become tools. `entity` is one tool per SDK entity and hint
 * class (`documents_read`), a discriminated union on `op`; `method` is one
 * tool per operation (`document-edit`), for reviewers that want each
 * operation as its own tool.
 */
export type ToolGrouping = 'entity' | 'method';

/** MCP's tool annotations; every hint is set explicitly. */
export type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
  /** The operations the tool runs, by the `op` value that selects each. */
  operations: ReadonlyMap<string, Operation>;
};

/** The input that selects an operation in an `entity` tool. */
export const OPERATION_INPUT = 'op';

/** The input capping how many items an iterating operation collects. */
export const MAX_ITEMS_INPUT = 'maxItems';
export const DEFAULT_MAX_ITEMS = 50;
const MAX_ITEMS_LIMIT = 200;

/** Longest operation summary an `entity` tool's description lists. */
const SUMMARY_LENGTH = 160;

const HINT_TITLES: Record<HintClass, string> = {
  read: 'read',
  write: 'create and change',
  delete: 'delete, overwrite and send',
};

/**
 * An operation's tool name: each segment snake_case, segments joined by
 * `-`, so `Database.columnCasts` and `DatabaseColumn.casts` stay apart.
 */
function methodToolName(operation: string) {
  return operation
    .split('.')
    .map((segment) =>
      segment.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    )
    .join('-');
}

function firstSentence(text: string) {
  const sentence = /^[\s\S]*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  const flat = sentence.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LENGTH
    ? `${flat.slice(0, SUMMARY_LENGTH - 1)}…`
    : flat;
}

function annotations(
  title: string,
  hint: HintClass,
  operations: readonly Operation[]
): ToolAnnotations {
  return {
    title,
    readOnlyHint: hint === 'read',
    destructiveHint: hint === 'delete',
    idempotentHint: operations.every((operation) => operation.idempotent),
    openWorldHint: operations.some((operation) => operation.openWorld),
  };
}

/** The inputs one operation takes: its receiver's reference, then its parameters. */
function operationInputs(
  writer: JsonSchemaWriter,
  catalog: Catalog,
  operation: Operation
) {
  const properties: JsonSchema = {};
  const required: string[] = [];
  if (operation.receiver.kind === 'handle') {
    const reference = writer.handle(operation.receiver.class);
    const handle = catalog.handles[operation.receiver.class];
    properties[operation.receiver.property] = {
      ...reference,
      description: `The ${operation.receiver.class} to act on: ${
        typeof reference.description === 'string' ? reference.description : ''
      }${handle?.description ? ` ${firstSentence(handle.description)}` : ''}`.trim(),
    };
    required.push(operation.receiver.property);
  }
  for (const parameter of operation.parameters) {
    properties[parameter.name] = writer.property(
      parameter.rest
        ? { ...parameter, schema: { type: 'array', items: parameter.schema } }
        : parameter
    );
    if (!parameter.optional) required.push(parameter.name);
  }
  if (operation.iterable)
    properties[MAX_ITEMS_INPUT] = {
      type: 'integer',
      minimum: 1,
      maximum: MAX_ITEMS_LIMIT,
      description: `Most items to return (default ${DEFAULT_MAX_ITEMS}).`,
    };
  return { properties, required };
}

function methodTool(catalog: Catalog, operation: Operation): Tool {
  const writer = new JsonSchemaWriter(catalog);
  const { properties, required } = operationInputs(writer, catalog, operation);
  const definitions = writer.definitions();
  return {
    name: methodToolName(operation.name),
    title: operation.name,
    description: operation.description || operation.name,
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
      ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
    },
    annotations: annotations(operation.name, operation.hint, [operation]),
    operations: new Map([[operation.name, operation]]),
  };
}

function entityTool(
  catalog: Catalog,
  group: string,
  hint: HintClass,
  operations: readonly Operation[]
): Tool {
  const writer = new JsonSchemaWriter(catalog);
  const branches = operations.map((operation) => {
    const { properties, required } = operationInputs(
      writer,
      catalog,
      operation
    );
    return {
      type: 'object',
      title: operation.name,
      description: operation.description || operation.name,
      properties: {
        [OPERATION_INPUT]: { const: operation.name },
        ...properties,
      },
      required: [OPERATION_INPUT, ...required],
      additionalProperties: false,
    };
  });
  const definitions = writer.definitions();
  const name = `${group}_${hint}`;
  const title = `${group.replaceAll('_', ' ')}: ${HINT_TITLES[hint]}`;
  const routing = catalog.groups[group] ?? '';
  const list = operations
    .map(
      (operation) =>
        `- ${operation.name}: ${firstSentence(operation.description)}`
    )
    .join('\n');
  return {
    name,
    title,
    description: `${routing}\n\nOperations (${HINT_TITLES[hint]}); pass one as \`${OPERATION_INPUT}\` with its inputs:\n${list}`,
    inputSchema: {
      type: 'object',
      properties: {
        [OPERATION_INPUT]: {
          type: 'string',
          enum: operations.map((operation) => operation.name),
          description: 'The operation to run.',
        },
      },
      required: [OPERATION_INPUT],
      oneOf: branches,
      ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
    },
    annotations: annotations(title, hint, operations),
    operations: new Map(
      operations.map((operation) => [operation.name, operation])
    ),
  };
}

const HINT_ORDER: readonly HintClass[] = ['read', 'write', 'delete'];

/** The catalog's tools, in a stable order; fails on a tool name used twice. */
export function buildTools(catalog: Catalog, grouping: ToolGrouping): Tool[] {
  const tools = match(grouping)
    .with('method', () =>
      catalog.operations.map((operation) => methodTool(catalog, operation))
    )
    .with('entity', () => {
      const groups = [
        ...new Set(catalog.operations.map((operation) => operation.group)),
      ].sort();
      return groups.flatMap((group) =>
        HINT_ORDER.flatMap((hint) => {
          const operations = catalog.operations.filter(
            (operation) => operation.group === group && operation.hint === hint
          );
          return operations.length
            ? [entityTool(catalog, group, hint, operations)]
            : [];
        })
      );
    })
    .exhaustive();

  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name))
      throw new Error(`two tools are named ${tool.name}`);
    if (!/^[a-z0-9_-]{1,64}$/.test(tool.name))
      throw new Error(`tool name ${tool.name} is not 1-64 of [a-z0-9_-]`);
    names.add(tool.name);
  }
  return tools;
}
