import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import {
  type DefinitionNode,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
  getNamedType,
  isCompositeType,
  isEnumType,
  isListType,
  isInterfaceType,
  isNonNullType,
  isObjectType,
  isScalarType,
} from 'graphql';

const CACHE_ONLY_DIRECTIVE = 'cacheOnly';

function isCacheOnly(
  directives: readonly { name: { value: string } }[] | undefined
): boolean {
  return (
    directives?.some(
      (directive) => directive.name.value === CACHE_ONLY_DIRECTIVE
    ) ?? false
  );
}

function selectionSetHasCacheOnly(selectionSet: SelectionSetNode): boolean {
  return selectionSet.selections.some((selection) => {
    if (selection.kind === 'Field') {
      return (
        isCacheOnly(selection.directives) ||
        (selection.selectionSet !== undefined &&
          selectionSetHasCacheOnly(selection.selectionSet))
      );
    }
    return (
      selection.kind === 'InlineFragment' &&
      selectionSetHasCacheOnly(selection.selectionSet)
    );
  });
}

function namedTypeScriptType(type: ReturnType<typeof getNamedType>): string {
  if (isScalarType(type)) {
    switch (type.name) {
      case 'ID':
      case 'String':
        return 'string';
      case 'Int':
      case 'Float':
        return 'number';
      case 'Boolean':
        return 'boolean';
      default:
        return 'unknown';
    }
  }
  if (isEnumType(type)) return type.name;
  throw new Error(`@cacheOnly projection cannot render leaf type ${type.name}`);
}

function wrapType(type: GraphQLOutputType, named: string): string {
  if (isNonNullType(type)) return wrapNonNullType(type.ofType, named);
  return `${wrapNonNullType(type, named)} | null`;
}

function wrapNonNullType(type: GraphQLOutputType, named: string): string {
  if (isListType(type)) return `Array<${wrapType(type.ofType, named)}>`;
  return named;
}

function operationRoot(
  schema: GraphQLSchema,
  operation: OperationDefinitionNode
): GraphQLCompositeType {
  const root =
    operation.operation === 'query'
      ? schema.getQueryType()
      : operation.operation === 'mutation'
        ? schema.getMutationType()
        : schema.getSubscriptionType();
  if (!root) throw new Error(`schema has no ${operation.operation} root`);
  return root;
}

function renderSelectionSet(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType,
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>
): string | undefined {
  if (!isObjectType(parent) && !isInterfaceType(parent)) {
    throw new Error(
      `@cacheOnly projection requires fields beneath ${parent.name} to use inline fragments`
    );
  }
  const properties: string[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      if (isCacheOnly(selection.directives)) continue;
      const field = parent.getFields()[selection.name.value];
      if (!field) {
        throw new Error(
          `@cacheOnly projection references unknown field ${parent.name}.${selection.name.value}`
        );
      }
      const namedType = getNamedType(field.type);
      let projectedType: string;
      if (isCompositeType(namedType)) {
        if (!selection.selectionSet) continue;
        const nested = renderSelectionSet(
          schema,
          namedType,
          selection.selectionSet,
          fragments
        );
        if (!nested) continue;
        projectedType = wrapType(field.type, nested);
      } else {
        projectedType = wrapType(field.type, namedTypeScriptType(namedType));
      }
      const responseKey = selection.alias?.value ?? selection.name.value;
      properties.push(`${JSON.stringify(responseKey)}: ${projectedType}`);
      continue;
    }

    throw new Error(
      '@cacheOnly result codegen does not yet support returned fragment fields'
    );
  }
  return properties.length > 0 ? `{ ${properties.join('; ')} }` : undefined;
}

/** Generates narrow result types containing only fields not marked `@cacheOnly`. */
export const plugin: PluginFunction = (schema, documents) => {
  const definitions: DefinitionNode[] = documents.flatMap(
    ({ document }) => document?.definitions ?? []
  );
  const fragments = new Map(
    definitions
      .filter(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === 'FragmentDefinition'
      )
      .map((fragment) => [fragment.name.value, fragment])
  );
  const output: string[] = [];
  for (const definition of definitions) {
    if (definition.kind !== 'OperationDefinition' || !definition.name) continue;
    if (!selectionSetHasCacheOnly(definition.selectionSet)) continue;
    const projection = renderSelectionSet(
      schema,
      operationRoot(schema, definition),
      definition.selectionSet,
      fragments
    );
    output.push(
      `export type ${definition.name.value}Result = ${projection ?? 'void'};`
    );
  }
  return output.join('\n\n');
};
