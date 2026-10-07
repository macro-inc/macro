import {
  assertValidSchema,
  buildSchema,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
import { readFile, writeFile } from 'node:fs/promises';

/** Generate the engine's versioned data artifact without generating native code. */
export function generateCacheRuntimeSchema(
  sdl: string,
  compatibilityEpoch: number
) {
  const schema = buildSchema(sdl);
  assertValidSchema(schema);
  const queryRoot = schema.getQueryType()?.name;
  if (!queryRoot) throw new Error('Cache schema requires a query root');
  const roots = [
    queryRoot,
    schema.getMutationType()?.name,
    schema.getSubscriptionType()?.name,
  ];
  const types = Object.values(schema.getTypeMap())
    .filter((type) => !type.name.startsWith('__'))
    .flatMap((type) => {
      if (!isObjectType(type) && !isInterfaceType(type) && !isUnionType(type))
        return [];
      const fields = isUnionType(type)
        ? []
        : Object.values(type.getFields()).map((field) => {
            const nullable = !isNonNullType(field.type);
            let inner = isNonNullType(field.type)
              ? field.type.ofType
              : field.type;
            const list = isListType(inner);
            let itemNullable = false;
            if (isListType(inner)) {
              itemNullable = !isNonNullType(inner.ofType);
              inner = isNonNullType(inner.ofType)
                ? inner.ofType.ofType
                : inner.ofType;
            }
            if (isListType(inner))
              throw new Error(
                `Nested lists are unsupported: ${type.name}.${field.name}`
              );
            const kind =
              isObjectType(inner) ||
              isInterfaceType(inner) ||
              isUnionType(inner)
                ? 'Composite'
                : isEnumType(inner) ||
                    (isScalarType(inner) &&
                      ['Int', 'Float', 'String', 'Boolean', 'ID'].includes(
                        inner.name
                      ))
                  ? 'Leaf'
                  : 'OpaqueScalar';
            return {
              name: field.name,
              ty: {
                name: inner.name,
                kind,
                nullable,
                list,
                item_nullable: itemNullable,
              },
            };
          });
      const id = fields.find((field) => field.name === 'id');
      if (
        id &&
        (roots.includes(type.name) ||
          id.ty.name !== 'ID' ||
          id.ty.nullable ||
          id.ty.list)
      ) {
        throw new Error(
          `Invalid cache entity id: ${type.name}.id must be ID! on a non-root type`
        );
      }
      return [
        {
          name: type.name,
          kind: isObjectType(type)
            ? 'Object'
            : isInterfaceType(type)
              ? 'Interface'
              : 'Union',
          key_fields: id ? ['id'] : null,
          fields: fields.sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0
          ),
          possible_types: isUnionType(type)
            ? type
                .getTypes()
                .map((t) => t.name)
                .sort()
            : isInterfaceType(type)
              ? schema
                  .getPossibleTypes(type)
                  .map((t) => t.name)
                  .sort()
              : [],
        },
      ];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    formatVersion: 1,
    compatibilityEpoch,
    queryRoot,
    mutationRoot: schema.getMutationType()?.name ?? null,
    subscriptionRoot: schema.getSubscriptionType()?.name ?? null,
    types,
  };
}

if (import.meta.main) {
  const sdl = await readFile(
    new URL('../../../static_assets/schema.graphql', import.meta.url),
    'utf8'
  );
  const codec = await readFile(
    new URL('../../../crates/client/cache-core/src/codec.rs', import.meta.url),
    'utf8'
  );
  const epoch = codec.match(
    /pub const CACHE_SCHEMA_COMPATIBILITY_EPOCH: u32 = (\d+);/
  )?.[1];
  if (!epoch) throw new Error('Missing cache compatibility epoch');
  const output = `${JSON.stringify(generateCacheRuntimeSchema(sdl, Number(epoch)))}\n`;
  const path = new URL(
    '../src/lib/graphql-cache/schema-artifact.json',
    import.meta.url
  );
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== output)
      throw new Error(
        'Cache runtime schema is stale; run bun run gen-cache-runtime-schema'
      );
  } else {
    await writeFile(path, output);
  }
}
