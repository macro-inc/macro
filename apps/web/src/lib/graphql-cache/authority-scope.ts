import {
  getOperationAST,
  Kind,
  parse,
  type SelectionSetNode,
  valueFromASTUntyped,
} from 'graphql';

/** Cache-only admission classification. The server remains the access authority. */
const NIL = '00000000-0000-0000-0000-000000000000';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function excluded(value: unknown, id: string): boolean {
  const expression = object(value);
  if (object(expression.literal)[id] === NIL) return true;
  const and = object(expression.and);
  return (
    !!expression.and && (excluded(and.left, id) || excluded(and.right, id))
  );
}

/** Match the Rust adapter's positive exclusion proof; unknown cursors miss. */
export function excludesCrmContent(value: unknown): boolean {
  const filters = object(value);
  const mail = object(filters.emailFilter);
  return (
    !filters.crmAssociation &&
    !mail.crmScope &&
    excluded(mail.tree, 'threadId') &&
    excluded(filters.crmCompanyFilter, 'id') &&
    (!filters.crmContactFilter || excluded(filters.crmContactFilter, 'id')) &&
    (!filters.databaseRowFilter || excluded(filters.databaseRowFilter, 'id'))
  );
}

const unrelatedEntityTypes = new Set([
  'DOCUMENT',
  'TASK',
  'PROJECT',
  'INITIATIVE',
  'CHAT',
  'CHANNEL',
  'CHANNEL_MESSAGE',
  'CALENDAR_EVENT',
  'CALL',
  'CALL_RECORD',
  'AGENT_SESSION',
  'FOREIGN_ENTITY',
  'USER',
]);
const protectedType =
  /^(GraphqlSoupCrm|GraphqlCrmPipeline|GraphqlSoupEmail|GraphqlMail|GraphqlProperty|GraphqlActivityEvent|GraphqlSavedView|GraphqlSoupDatabaseRow)/;
const protectedFields = new Set([
  'emailThread',
  'emailFocus',
  'savedView',
  'savedViews',
  'activity',
  'activityOverview',
  'databaseActivity',
  'databaseViewRows',
  'workFeed',
  'attentionFeed',
  'favorites',
  'propertyOptions',
  'propertyDefinitions',
]);

function protectedKey(key: unknown): boolean {
  return (
    typeof key !== 'string' ||
    key.startsWith('GraphqlUser:') ||
    protectedType.test(key)
  );
}

/** Resolve each field's own arguments, including aliases and literal inputs. */
export function queryNeedsCrmProof(
  query: string,
  variables: Record<string, unknown> = {},
  operationName?: string
): boolean {
  try {
    const document = parse(query);
    const operation = getOperationAST(document, operationName);
    if (!operation) return true;
    const fragments = new Map(
      document.definitions.flatMap((definition) =>
        definition.kind === Kind.FRAGMENT_DEFINITION
          ? [[definition.name.value, definition] as const]
          : []
      )
    );
    const visited = new Set<string>();
    const selectionNeedsProof = (selectionSet: SelectionSetNode): boolean =>
      selectionSet.selections.some((selection): boolean => {
        if (selection.kind === Kind.FRAGMENT_SPREAD) {
          if (visited.has(selection.name.value)) return false;
          visited.add(selection.name.value);
          const fragment = fragments.get(selection.name.value);
          return (
            !fragment ||
            protectedType.test(fragment.typeCondition.name.value) ||
            selectionNeedsProof(fragment.selectionSet)
          );
        }
        if (selection.kind === Kind.INLINE_FRAGMENT)
          return (
            (selection.typeCondition &&
              protectedType.test(selection.typeCondition.name.value)) ||
            selectionNeedsProof(selection.selectionSet)
          );
        const name = selection.name.value;
        const args = Object.fromEntries(
          (selection.arguments ?? []).map((arg) => [
            arg.name.value,
            valueFromASTUntyped(arg.value, variables),
          ])
        );
        const input = object(args.input);
        // A positive scope proof applies to this complete selection, including
        // union fragments for other kinds that the server cannot return here.
        if (name === 'soupEntity')
          return !unrelatedEntityTypes.has(String(input.entityType));
        if (name === 'soup' || name === 'groupSoup')
          return !excludesCrmContent(object(input.initial).filters);
        if (
          name === 'setEntityProperty' ||
          name === 'updateEntityPropertyOptions'
        )
          return !unrelatedEntityTypes.has(String(input.entityType));
        if (
          name === 'propertyDefinitions' &&
          ['SYSTEM', 'USER', 'TEAM'].includes(String(args.scope))
        )
          return false;
        if (
          name === 'savedViews' &&
          typeof args.kind === 'string' &&
          !['crm', 'crm-list'].includes(args.kind)
        )
          return false;
        if (protectedFields.has(name)) return true;
        return selection.selectionSet
          ? selectionNeedsProof(selection.selectionSet)
          : false;
      });
    return selectionNeedsProof(operation.selectionSet);
  } catch {
    return true;
  }
}

/** Accepts both worker requests and the equivalent native command arguments. */
export function requestNeedsCrmProof(
  kind: string,
  value: Record<string, unknown>
): boolean {
  kind = kind.replace(/^graphql_cache_/, '').replaceAll('_', '-');
  if (kind === 'hydrate-scoped')
    return requestNeedsCrmProof('hydrate', object(value.request));
  if (typeof value.query === 'string')
    return queryNeedsCrmProof(
      value.query,
      object(value.variables),
      typeof value.operationName === 'string' ? value.operationName : undefined
    );
  if (kind === 'read-records-by-keys')
    return !Array.isArray(value.keys) || value.keys.some(protectedKey);
  if (kind === 'search') {
    const buckets = object(value.request).buckets;
    return (
      !Array.isArray(buckets) ||
      buckets.some((bucket) =>
        ['email', 'crm_company', 'crm_contact', 'company', 'contact'].includes(
          String(bucket)
        )
      )
    );
  }
  if (kind === 'entity-filter')
    return !excludesCrmContent(object(value.request).filters);
  if (kind === 'entity-filter-resume') return true;
  return false;
}

export const isAuthorityWrite = (kind: string) =>
  [
    'write',
    'hydrate',
    'hydrate-scoped',
    'enqueue-optimistic-mutation',
    'commit-optimistic-write',
  ].includes(kind.replace(/^graphql_cache_/, '').replaceAll('_', '-'));

export const isAuthorityLifecycle = (kind: string) =>
  [
    'init',
    'init-with-schema',
    'current-authority',
    'transition-authority',
    'current-revision',
    'current-storage-generation',
    'clear',
    'teardown',
    'claim-next-mutation',
    'defer-optimistic-write',
    'rollback-optimistic-write',
    'inspect-mutations',
  ].includes(kind.replace(/^graphql_cache_/, '').replaceAll('_', '-'));

export const isAuthoredSettlement = (kind: string) =>
  [
    'enqueue-optimistic-mutation',
    'commit-optimistic-write',
    'claim-next-mutation',
    'defer-optimistic-write',
    'rollback-optimistic-write',
  ].includes(kind.replace(/^graphql_cache_/, '').replaceAll('_', '-'));
