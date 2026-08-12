import {
  GraphQLID,
  type GraphQLInputType,
  type GraphQLObjectType,
  assertValidSchema,
  buildASTSchema,
  getNamedType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  parse,
} from 'graphql';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Input recursion is bounded so an SDL cycle or unexpectedly deep input shape
 * fails generation instead of silently producing incomplete argument paths.
 */
export const MAX_ENTITY_RESOLVER_INPUT_DEPTH = 16;

type FieldMetadata = {
  targets: string[];
  argumentPaths: string[][];
};

export type EntityResolverSchemaMetadata = Record<
  string,
  Record<string, FieldMetadata>
>;

/** Locale-independent UTF-16 code-unit ordering, matching ECMAScript strings. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isKeyableObject(type: GraphQLObjectType): boolean {
  const id = type.getFields().id;
  return id !== undefined && isNonNullType(id.type) && id.type.ofType === GraphQLID;
}

function collectArgumentPaths(
  type: GraphQLInputType,
  path: string[],
  visited: ReadonlySet<string>,
  depth: number,
  ownerField: string,
  output: string[][]
): void {
  if (depth > MAX_ENTITY_RESOLVER_INPUT_DEPTH) {
    throw new Error(
      `entity resolver input path for ${ownerField} exceeds maximum depth ${MAX_ENTITY_RESOLVER_INPUT_DEPTH}`
    );
  }
  const nullableType = isNonNullType(type) ? type.ofType : type;
  if (isListType(nullableType)) return;
  if (nullableType === GraphQLID) {
    output.push(path);
    return;
  }
  if (!isInputObjectType(nullableType)) return;
  if (visited.has(nullableType.name)) {
    throw new Error(
      `recursive input type ${nullableType.name} reached while generating entity resolver paths for ${ownerField}`
    );
  }

  const nextVisited = new Set(visited);
  nextVisited.add(nullableType.name);
  const fields = Object.values(nullableType.getFields()).sort((a, b) =>
    compareCodeUnits(a.name, b.name)
  );
  for (const field of fields) {
    collectArgumentPaths(
      field.type,
      [...path, field.name],
      nextVisited,
      depth + 1,
      ownerField,
      output
    );
  }
}

/** Derives resolver metadata from a validated GraphQL SDL document. */
export function deriveEntityResolverSchema(
  schemaSource: string
): EntityResolverSchemaMetadata {
  const schema = buildASTSchema(parse(schemaSource));
  assertValidSchema(schema);
  const metadata: EntityResolverSchemaMetadata = {};

  const owners = Object.values(schema.getTypeMap())
    .filter(
      (type): type is GraphQLObjectType =>
        isObjectType(type) && !type.name.startsWith('__')
    )
    .sort((a, b) => compareCodeUnits(a.name, b.name));

  for (const owner of owners) {
    const fields: Record<string, FieldMetadata> = {};
    for (const field of Object.values(owner.getFields()).sort((a, b) =>
      compareCodeUnits(a.name, b.name)
    )) {
      const nullableReturn = isNonNullType(field.type)
        ? field.type.ofType
        : field.type;
      if (isListType(nullableReturn)) continue;
      const returnType = getNamedType(nullableReturn);
      if (
        !isObjectType(returnType) &&
        !isInterfaceType(returnType) &&
        !isUnionType(returnType)
      ) {
        continue;
      }

      let targets: string[];
      if (isObjectType(returnType)) {
        targets = isKeyableObject(returnType) ? [returnType.name] : [];
      } else {
        targets = schema
          .getPossibleTypes(returnType)
          .filter(isKeyableObject)
          .map((type) => type.name)
          .sort(compareCodeUnits);
      }
      if (targets.length === 0) continue;

      const argumentPaths: string[][] = [];
      for (const argument of [...field.args].sort((a, b) =>
        compareCodeUnits(a.name, b.name)
      )) {
        collectArgumentPaths(
          argument.type,
          [argument.name],
          new Set(),
          0,
          `${owner.name}.${field.name}`,
          argumentPaths
        );
      }
      argumentPaths.sort((a, b) =>
        compareCodeUnits(JSON.stringify(a), JSON.stringify(b))
      );
      if (argumentPaths.length === 0) continue;
      fields[field.name] = { targets, argumentPaths };
    }
    if (Object.keys(fields).length > 0) metadata[owner.name] = fields;
  }

  return metadata;
}

function quote(value: string): string {
  // GraphQL names cannot contain a single quote.
  return `'${value}'`;
}

function tuple(values: readonly string[]): string {
  return `[${values.map(quote).join(', ')}]`;
}

function quoteTuple(values: readonly string[]): string {
  return `readonly ${tuple(values)}`;
}

/** Renders deterministic committed TypeScript metadata. */
export function renderEntityResolverSchema(
  metadata: EntityResolverSchemaMetadata
): string {
  const targets = new Set<string>();
  const paths = new Map<string, string[]>();
  const lines = [
    '// @generated by scripts/generate-graphql-cache-entity-resolver-schema.ts — do not edit.',
    '',
    'export const entityResolverSchema = {',
  ];

  for (const parent of Object.keys(metadata).sort(compareCodeUnits)) {
    lines.push(`  ${parent}: {`);
    const fields = metadata[parent] ?? {};
    for (const fieldName of Object.keys(fields).sort(compareCodeUnits)) {
      const field = fields[fieldName];
      if (!field) continue;
      for (const target of field.targets) targets.add(target);
      for (const path of field.argumentPaths) {
        paths.set(JSON.stringify(path), path);
      }
      lines.push(`    ${fieldName}: {`);
      lines.push(`      targets: [${field.targets.map(quote).join(', ')}],`);
      if (field.argumentPaths.length === 1) {
        lines.push(`      argumentPaths: [${tuple(field.argumentPaths[0] ?? [])}],`);
      } else {
        lines.push('      argumentPaths: [');
        for (const path of field.argumentPaths) {
          lines.push(`        ${tuple(path)},`);
        }
        lines.push('      ],');
      }
      lines.push('    },');
    }
    lines.push('  },');
  }
  lines.push('} as const;', '');
  lines.push(
    'export type GeneratedEntityResolverSchema = typeof entityResolverSchema;'
  );
  const sortedTargets = [...targets].sort(compareCodeUnits);
  if (sortedTargets.length === 0) {
    lines.push('export type GeneratedEntityResolverTarget = never;');
  } else {
    lines.push('export type GeneratedEntityResolverTarget =');
    for (const [index, target] of sortedTargets.entries()) {
      lines.push(
        `  | ${quote(target)}${
          index === sortedTargets.length - 1 ? ';' : ''
        }`
      );
    }
  }
  const sortedPaths = [...paths.values()].sort((a, b) =>
    compareCodeUnits(JSON.stringify(a), JSON.stringify(b))
  );
  if (sortedPaths.length === 0) {
    lines.push('export type GeneratedEntityResolverArgumentPath = never;');
  } else {
    lines.push('export type GeneratedEntityResolverArgumentPath =');
    for (const [index, path] of sortedPaths.entries()) {
      lines.push(
        `  | ${quoteTuple(path)}${
          index === sortedPaths.length - 1 ? ';' : ''
        }`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const webDirectory = resolve(scriptDirectory, '..');
  const schemaPath = resolve(webDirectory, '../../static_assets/schema.graphql');
  const outputPath = resolve(
    webDirectory,
    'src/lib/graphql-cache/generated/entity-resolver-schema.ts'
  );
  const output = renderEntityResolverSchema(
    deriveEntityResolverSchema(await Bun.file(schemaPath).text())
  );

  if (process.argv.includes('--check')) {
    const current = await Bun.file(outputPath).text().catch(() => undefined);
    if (current !== output) {
      throw new Error(
        'GraphQL cache entity resolver schema is stale; run `bun run gen-graphql-cache-schema`'
      );
    }
    return;
  }
  await Bun.write(outputPath, output);
}

if (import.meta.main) {
  await main();
}
