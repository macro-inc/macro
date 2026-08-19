import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import {
  type DefinitionNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type GraphQLSchema,
  getNamedType,
  isCompositeType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  type OperationDefinitionNode,
  type SelectionSetNode,
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

type SelectionSetContext = {
  selectionSet: SelectionSetNode;
  activeFragments: Set<string>;
};

type FieldContext = {
  field: FieldNode;
  scope: GraphQLCompositeType;
  activeFragments: Set<string>;
};

function renderSelectionSetForObject(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType,
  concreteType: GraphQLObjectType,
  selectionSets: readonly SelectionSetContext[],
  fragments: ReadonlyMap<string, FragmentDefinitionNode>
): string | undefined {
  const fieldsByResponseKey = new Map<string, FieldContext[]>();

  const renderSelections = (
    scope: GraphQLCompositeType,
    selections: SelectionSetNode,
    activeFragments: Set<string>
  ): void => {
    for (const selection of selections.selections) {
      match(selection)
        .with({ kind: 'Field' }, (field) => {
          if (isCacheOnly(field.directives)) return;
          const responseKey = field.alias?.value ?? field.name.value;
          const fields = fieldsByResponseKey.get(responseKey) ?? [];
          fields.push({
            field,
            scope,
            activeFragments: new Set(activeFragments),
          });
          fieldsByResponseKey.set(responseKey, fields);
        })
        .with({ kind: 'FragmentSpread' }, (fragmentSpread) => {
          const fragmentName = fragmentSpread.name.value;
          const fragment = fragments.get(fragmentName);
          if (!fragment) throw new Error(`unknown fragment ${fragmentName}`);
          if (activeFragments.has(fragmentName)) return;

          const condition = compositeType(
            schema,
            fragment.typeCondition.name.value
          );
          if (!typeConditionApplies(schema, condition, concreteType)) return;

          activeFragments.add(fragmentName);
          renderSelections(condition, fragment.selectionSet, activeFragments);
          activeFragments.delete(fragmentName);
        })
        .with({ kind: 'InlineFragment' }, (inlineFragment) => {
          const condition = inlineFragment.typeCondition
            ? compositeType(schema, inlineFragment.typeCondition.name.value)
            : scope;
          if (!typeConditionApplies(schema, condition, concreteType)) return;
          renderSelections(
            condition,
            inlineFragment.selectionSet,
            activeFragments
          );
        })
        .exhaustive();
    }
  };

  for (const { selectionSet, activeFragments } of selectionSets) {
    renderSelections(parent, selectionSet, activeFragments);
  }

  const properties: string[] = [];
  for (const [responseKey, fieldContexts] of fieldsByResponseKey) {
    const first = fieldContexts[0];
    if (!first) continue;
    if (first.field.name.value === '__typename') {
      properties.push(
        `${JSON.stringify(responseKey)}: ${JSON.stringify(concreteType.name)}`
      );
      continue;
    }
    if (!isObjectType(first.scope) && !isInterfaceType(first.scope)) {
      throw new Error(
        `@cacheOnly projection requires fields beneath ${first.scope.name} to use fragments`
      );
    }
    const field = first.scope.getFields()[first.field.name.value];
    if (!field) {
      throw new Error(
        `@cacheOnly projection references unknown field ${first.scope.name}.${first.field.name.value}`
      );
    }
    const namedType = getNamedType(field.type);
    let projectedType: string;
    if (isCompositeType(namedType)) {
      const nestedSelectionSets = fieldContexts.flatMap(
        ({ field: selectedField, activeFragments }) =>
          selectedField.selectionSet
            ? [
                {
                  selectionSet: selectedField.selectionSet,
                  activeFragments,
                },
              ]
            : []
      );
      if (nestedSelectionSets.length === 0) continue;
      const nested = renderSelectionSet(
        schema,
        namedType,
        nestedSelectionSets,
        fragments
      );
      if (!nested) continue;
      projectedType = wrapType(field.type, nested);
    } else {
      projectedType = wrapType(field.type, namedTypeScriptType(namedType));
    }
    properties.push(`${JSON.stringify(responseKey)}: ${projectedType}`);
  }

  return properties.length > 0 ? `{ ${properties.join('; ')} }` : undefined;
}

function renderSelectionSet(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType,
  selectionSets: readonly SelectionSetContext[],
  fragments: ReadonlyMap<string, FragmentDefinitionNode>
): string | undefined {
  const projections = possibleObjectTypes(schema, parent).map((concreteType) =>
    renderSelectionSetForObject(
      schema,
      parent,
      concreteType,
      selectionSets,
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
      [
        {
          selectionSet: definition.selectionSet,
          activeFragments: new Set(),
        },
      ],
      fragments
    );
    output.push(
      `export type ${definition.name.value}Result = ${projection ?? 'void'};`
    );
  }
  return output.join('\n\n');
};
