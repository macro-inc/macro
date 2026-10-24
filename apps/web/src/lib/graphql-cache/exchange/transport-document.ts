import {
  type ASTNode,
  type DefinitionNode,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  Kind,
  type OperationDefinitionNode,
  visit,
} from 'graphql';

const CLIENT_DIRECTIVES = /@(?:cacheOnly|fromCache)\b/;

const TYPENAME: FieldNode = {
  kind: Kind.FIELD,
  name: { kind: Kind.NAME, value: '__typename' },
};

/** Whether a document's text uses a directive the server does not know. */
export function hasClientDirectives(query: string): boolean {
  return CLIENT_DIRECTIVES.test(query);
}

/**
 * The document the server receives. `@cacheOnly` fields are still fetched, so
 * only the directive is stripped. A `@fromCache` field is removed with its
 * arguments and selections: only the device cache supplies it. A selection set
 * left empty selects `__typename` instead, so its parent is still fetched, and
 * fragments and variables that only removed fields used are dropped.
 */
export function transportDocument(document: DocumentNode): DocumentNode {
  return removeFromCacheFields(document, { stripCacheOnly: true });
}

/**
 * The document for a cache engine built before `@fromCache`: its fields are
 * removed as for the server, and `@cacheOnly` is kept.
 */
export function withoutFromCacheFields(document: DocumentNode): DocumentNode {
  return removeFromCacheFields(document, { stripCacheOnly: false });
}

function removeFromCacheFields(
  document: DocumentNode,
  options: { stripCacheOnly: boolean }
): DocumentNode {
  let removedFields = false;
  const stripped = visit(document, {
    Field(node) {
      if (!node.directives?.some(({ name }) => name.value === 'fromCache'))
        return undefined;
      removedFields = true;
      return null;
    },
    Directive(node) {
      return options.stripCacheOnly && node.name.value === 'cacheOnly'
        ? null
        : undefined;
    },
    SelectionSet: {
      leave(node) {
        return node.selections.length > 0
          ? undefined
          : { ...node, selections: [TYPENAME] };
      },
    },
  });
  return removedFields ? withoutUnusedDefinitions(stripped) : stripped;
}

function withoutUnusedDefinitions(document: DocumentNode): DocumentNode {
  const fragments = new Map<string, FragmentDefinitionNode>();
  const operations: OperationDefinitionNode[] = [];
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION)
      fragments.set(definition.name.value, definition);
    else if (definition.kind === Kind.OPERATION_DEFINITION)
      operations.push(definition);
  }
  if (operations.length === 0) return document;

  const usedFragments = new Set<string>();
  const usedOperations = new Map<OperationDefinitionNode, Set<string>>();
  for (const operation of operations) {
    // Variable definitions name every variable; only uses keep one.
    const body = { ...operation, variableDefinitions: [] };
    const variables = variablesUsed(body);
    const reached = new Set<string>();
    const reach = (names: Set<string>): void => {
      for (const name of names) {
        const fragment = fragments.get(name);
        if (!fragment || reached.has(name)) continue;
        reached.add(name);
        for (const variable of variablesUsed(fragment)) variables.add(variable);
        reach(spreadsUsed(fragment));
      }
    };
    reach(spreadsUsed(body));
    for (const name of reached) usedFragments.add(name);
    usedOperations.set(operation, variables);
  }

  return {
    ...document,
    definitions: document.definitions.flatMap(
      (definition): DefinitionNode[] => {
        if (definition.kind === Kind.FRAGMENT_DEFINITION)
          return usedFragments.has(definition.name.value) ? [definition] : [];
        if (definition.kind !== Kind.OPERATION_DEFINITION) return [definition];
        const variables = usedOperations.get(definition);
        return [
          {
            ...definition,
            variableDefinitions: definition.variableDefinitions?.filter(
              ({ variable }) => variables?.has(variable.name.value)
            ),
          },
        ];
      }
    ),
  };
}

function spreadsUsed(node: ASTNode): Set<string> {
  const names = new Set<string>();
  visit(node, {
    FragmentSpread(spread) {
      names.add(spread.name.value);
    },
  });
  return names;
}

function variablesUsed(node: ASTNode): Set<string> {
  const names = new Set<string>();
  visit(node, {
    Variable(variable) {
      names.add(variable.name.value);
    },
  });
  return names;
}
