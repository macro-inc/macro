import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import {
  type DefinitionNode,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
  getNamedType,
  isCompositeType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
} from 'graphql';
import { match } from 'ts-pattern';

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

function selectionSetHasCacheOnly(
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  activeFragments = new Set<string>()
): boolean {
  return selectionSet.selections.some((selection) => {
    if (selection.kind === 'Field') {
      return (
        isCacheOnly(selection.directives) ||
        (selection.selectionSet !== undefined &&
          selectionSetHasCacheOnly(
            selection.selectionSet,
            fragments,
            activeFragments
          ))
      );
    }
    if (selection.kind === 'InlineFragment') {
      return selectionSetHasCacheOnly(
        selection.selectionSet,
        fragments,
        activeFragments
      );
    }

    const fragmentName = selection.name.value;
    const fragment = fragments.get(fragmentName);
    if (!fragment) throw new Error(`unknown fragment ${fragmentName}`);
    if (activeFragments.has(fragmentName)) return false;
    activeFragments.add(fragmentName);
    const hasCacheOnly = selectionSetHasCacheOnly(
      fragment.selectionSet,
      fragments,
      activeFragments
    );
    activeFragments.delete(fragmentName);
    return hasCacheOnly;
  });
}

function namedTypeScriptType(type: ReturnType<typeof getNamedType>): string {
  if (isScalarType(type)) {
    return match(type.name)
      .with('ID', 'String', () => 'string')
      .with('Int', 'Float', () => 'number')
      .with('Boolean', () => 'boolean')
      .otherwise(() => 'unknown');
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

function compositeType(
  schema: GraphQLSchema,
  typeName: string
): GraphQLCompositeType {
  const type = schema.getType(typeName);
  if (!type || !isCompositeType(type)) {
    throw new Error(`fragment type condition ${typeName} is not composite`);
  }
  return type;
}

function possibleObjectTypes(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType
): readonly GraphQLObjectType[] {
  return isObjectType(parent) ? [parent] : schema.getPossibleTypes(parent);
}

function typeConditionApplies(
  schema: GraphQLSchema,
  condition: GraphQLCompositeType,
  concreteType: GraphQLObjectType
): boolean {
  return isObjectType(condition)
    ? condition.name === concreteType.name
    : schema.isSubType(condition, concreteType);
}

function renderSelectionSetForObject(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType,
  concreteType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  activeFragments = new Set<string>()
): string | undefined {
  const properties = new Set<string>();

  const renderSelections = (
    scope: GraphQLCompositeType,
    selections: SelectionSetNode
  ): void => {
    for (const selection of selections.selections) {
      if (selection.kind === 'Field') {
        if (isCacheOnly(selection.directives)) continue;
        const responseKey = selection.alias?.value ?? selection.name.value;
        if (selection.name.value === '__typename') {
          properties.add(
            `${JSON.stringify(responseKey)}: ${JSON.stringify(concreteType.name)}`
          );
          continue;
        }
        if (!isObjectType(scope) && !isInterfaceType(scope)) {
          throw new Error(
            `@cacheOnly projection requires fields beneath ${scope.name} to use fragments`
          );
        }
        const field = scope.getFields()[selection.name.value];
        if (!field) {
          throw new Error(
            `@cacheOnly projection references unknown field ${scope.name}.${selection.name.value}`
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
        properties.add(`${JSON.stringify(responseKey)}: ${projectedType}`);
        continue;
      }

      const fragment =
        selection.kind === 'FragmentSpread'
          ? fragments.get(selection.name.value)
          : undefined;
      if (selection.kind === 'FragmentSpread' && !fragment) {
        throw new Error(`unknown fragment ${selection.name.value}`);
      }
      const fragmentName = fragment?.name.value;
      if (fragmentName && activeFragments.has(fragmentName)) continue;
      const conditionName =
        selection.kind === 'InlineFragment'
          ? selection.typeCondition?.name.value
          : fragment?.typeCondition.name.value;
      const condition = conditionName
        ? compositeType(schema, conditionName)
        : scope;
      if (!typeConditionApplies(schema, condition, concreteType)) continue;

      if (fragmentName) activeFragments.add(fragmentName);
      renderSelections(
        condition,
        selection.kind === 'InlineFragment'
          ? selection.selectionSet
          : fragment!.selectionSet
      );
      if (fragmentName) activeFragments.delete(fragmentName);
    }
  };

  renderSelections(parent, selectionSet);
  return properties.size > 0
    ? `{ ${Array.from(properties).join('; ')} }`
    : undefined;
}

function renderSelectionSet(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType,
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>
): string | undefined {
  const projections = possibleObjectTypes(schema, parent).map((concreteType) =>
    renderSelectionSetForObject(
      schema,
      parent,
      concreteType,
      selectionSet,
      fragments
    )
  );
  if (projections.every((projection) => projection === undefined)) return;

  const branches = Array.from(
    new Set(projections.map((projection) => projection ?? '{}'))
  );
  return branches.length === 1 ? branches[0] : `(${branches.join(' | ')})`;
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
    if (!selectionSetHasCacheOnly(definition.selectionSet, fragments)) continue;
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
