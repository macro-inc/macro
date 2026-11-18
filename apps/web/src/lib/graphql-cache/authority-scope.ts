import {
  type DocumentNode,
  getOperationAST,
  Kind,
  type OperationTypeNode,
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

/** Ordinary mail has owned or explicit grants; only crmScope expands CRM mail. */
export function excludesCrmContent(value: unknown): boolean {
  const filters = object(value);
  const mail = object(filters.emailFilter);
  return (
    !filters.crmAssociation &&
    !mail.crmScope &&
    excluded(filters.crmCompanyFilter, 'id') &&
    (!filters.crmContactFilter || excluded(filters.crmContactFilter, 'id'))
  );
}

function restExcludesCrmRecords(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  const expression = object(value);
  if (Object.keys(expression).length !== 1) return false;
  const literal = object(expression.l);
  if (Object.keys(literal).length === 1 && literal.id === NIL) return true;
  const and = expression['&'];
  return (
    Array.isArray(and) &&
    and.length === 2 &&
    and.some((branch) => restExcludesCrmRecords(branch, depth + 1))
  );
}

/** REST folder views cannot be translated to GraphQL, but share its CRM scope.
 * The router adds CRM mail grants only from eca/ecd, independently of ef. */
export function restSoupAstExcludesCrmContent(value: unknown): boolean {
  const body = object(value);
  return (
    body.crma == null &&
    [body.eca, body.ecd].every(
      (scope) =>
        scope === undefined || (Array.isArray(scope) && scope.length === 0)
    ) &&
    restExcludesCrmRecords(body.ccf) &&
    (body.crmf == null || restExcludesCrmRecords(body.crmf))
  );
}

const unrelatedEntityTypes = new Set([
  'DOCUMENT',
  // Soup rows require a database_entities owner; CRM pipeline rows have
  // separate GraphqlCrmPipeline* contracts over reusable database storage.
  'DATABASE_ROW',
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
  /^(GraphqlSoupCrm|GraphqlCrmPipeline|GraphqlSoupEmail|GraphqlMail|GraphqlProperty|GraphqlActivityEvent|GraphqlSavedView)/;
const protectedFields = new Set([
  'emailThread',
  'savedView',
  'savedViews',
  'activity',
  'activityOverview',
  'databaseActivity',
  'attentionFeed',
  'propertyOptions',
  'propertyDefinitions',
]);

// These resolver contracts cannot return CRM-derived content. Their children
// reuse broad union fragments, so classification stops at the scoped field.
const independentFields = new Set([
  'emailLinks',
  'emailFocus',
  'workFeed',
  'workFeedUpdates',
  'favorites',
  'databaseViewRows',
]);

// EmailMutationThreadLoader reloads only the writer's owned/delegated inboxes.
// These commands cannot return a thread solely through a CRM grant.
const independentEmailMutations = new Set([
  'markEmailThreadSeen',
  'markEmailThreadUnread',
  'setEmailThreadState',
  'resolveEmailMessageOperation',
  'setEmailThreadArchived',
  'setEmailThreadsArchived',
  'updateEmailThreadLabel',
  'sendEmailMessage',
  'saveEmailDraft',
  'deleteEmailDraft',
  'sendEmailAttempt',
  'cancelEmailSend',
]);

// These are short-lived ownership witnesses, not cached record content. Each
// check retains its source account, owner and generation; replacement closes it.
const ownedEmails = new Map<string, () => boolean>();
const activeOwnedEmails = new Map<
  string,
  { references: number; isCurrent: (() => boolean) | undefined }
>();

/** Hold one bounded read's witnesses across awaits, independently of idle eviction. */
export function retainOwnedEmailWitnesses(threadIds: readonly string[]) {
  const ids = [...new Set(threadIds)];
  if (ids.length > 500)
    throw new Error('Mail ownership retention exceeds one chunk');
  for (const id of ids) {
    const active = activeOwnedEmails.get(id);
    if (active) active.references += 1;
    else
      activeOwnedEmails.set(id, {
        references: 1,
        isCurrent: ownedEmails.get(id),
      });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of ids) {
      const active = activeOwnedEmails.get(id);
      if (active && --active.references === 0) activeOwnedEmails.delete(id);
    }
  };
}

export function rememberOwnedEmail(id: string, isCurrent: () => boolean) {
  const active = activeOwnedEmails.get(id);
  if (active) active.isCurrent = isCurrent;
  ownedEmails.delete(id);
  ownedEmails.set(id, isCurrent);
  // One 500-row page can contain both requested and canonical alias IDs.
  if (ownedEmails.size > 1024)
    ownedEmails.delete(ownedEmails.keys().next().value!);
}
export function hasOwnedEmailWitness(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const active = activeOwnedEmails.get(id);
  const witness = active?.isCurrent ?? ownedEmails.get(id);
  if (!witness) return false;
  if (witness()) return true;
  if (active) active.isCurrent = undefined;
  ownedEmails.delete(id);
  return false;
}

function protectedKey(key: unknown): boolean {
  if (typeof key === 'string' && key.startsWith('GraphqlSoupEmailThread:'))
    return !hasOwnedEmailWitness(key.slice('GraphqlSoupEmailThread:'.length));
  return (
    typeof key !== 'string' ||
    key.startsWith('GraphqlUser:') ||
    protectedType.test(key)
  );
}

type CursorField = 'soup' | 'groupSoup' | 'restSoupAst';
type CursorWitness = {
  query: string;
  operationName: string | undefined;
  field: CursorField;
  groupKey: string | undefined;
  isCurrent: () => boolean;
};
const cursorWitnesses = new Map<string, CursorWitness>();
const MAX_CURSOR_WITNESSES = 128;
const MAX_SCOPE_TEXT_BYTES = 2_000_000;
let cursorBytes = 0;

function forgetCursor(cursor: string) {
  const witness = cursorWitnesses.get(cursor);
  if (!witness) return;
  cursorBytes -= (cursor.length + witness.query.length) * 2;
  cursorWitnesses.delete(cursor);
}

function hasCursorWitness(
  query: string,
  operationName: string | undefined,
  field: CursorField,
  continuation: Record<string, unknown>
) {
  const cursor = continuation.cursor;
  if (typeof cursor !== 'string') return false;
  const witness = cursorWitnesses.get(cursor);
  if (!witness) return false;
  if (!witness.isCurrent()) {
    forgetCursor(cursor);
    return false;
  }
  return (
    witness.query === query &&
    witness.operationName === operationName &&
    witness.field === field &&
    (field !== 'groupSoup' || witness.groupKey === continuation.groupKey)
  );
}

function rememberCursor(cursor: unknown, witness: CursorWitness) {
  if (typeof cursor !== 'string' || !cursor || !witness.isCurrent()) return;
  const bytes = (cursor.length + witness.query.length) * 2;
  if (bytes > MAX_SCOPE_TEXT_BYTES) return;
  forgetCursor(cursor);
  cursorWitnesses.set(cursor, witness);
  cursorBytes += bytes;
  while (
    cursorWitnesses.size > MAX_CURSOR_WITNESSES ||
    cursorBytes > MAX_SCOPE_TEXT_BYTES
  )
    forgetCursor(cursorWitnesses.keys().next().value!);
}

/** REST cursors carry their original filter; the next request's body cannot
 * establish their scope. Reuse only a decoded parent from the same login. */
export function hasIndependentRestSoupCursor(body: string, cursor: string) {
  return hasCursorWitness(body, undefined, 'restSoupAst', { cursor });
}

export function rememberIndependentRestSoupCursor(
  body: string,
  cursor: unknown,
  isCurrent: () => boolean
) {
  rememberCursor(cursor, {
    query: body,
    operationName: undefined,
    field: 'restSoupAst',
    groupKey: undefined,
    isCurrent,
  });
}

type ScopeCheck = (
  variables: Record<string, unknown>,
  allowWitnesses?: boolean
) => boolean;
type CompiledScope = {
  check: ScopeCheck;
  kind?: OperationTypeNode;
  operationName?: string;
  cursorFields?: ReadonlySet<CursorField>;
};
const documents = new Map<
  string,
  {
    document?: DocumentNode;
    operations: Map<string | undefined, CompiledScope>;
  }
>();
let documentBytes = 0;
const protectedScope: CompiledScope = { check: () => true };

function cachedDocument(query: string) {
  let cached = documents.get(query);
  if (cached) {
    documents.delete(query);
    documents.set(query, cached);
  } else {
    try {
      cached = { document: parse(query), operations: new Map() };
    } catch {
      cached = { operations: new Map() };
    }
    // Bound retained ASTs, including ad hoc documents and invalid input.
    if (query.length * 2 <= MAX_SCOPE_TEXT_BYTES) {
      documents.set(query, cached);
      documentBytes += query.length * 2;
      while (documents.size > 64 || documentBytes > MAX_SCOPE_TEXT_BYTES) {
        const oldest = documents.keys().next().value!;
        documents.delete(oldest);
        documentBytes -= oldest.length * 2;
      }
    }
  }
  return cached;
}

function compiledScope(query: string, operationName?: string): CompiledScope {
  const cached = cachedDocument(query);
  const previous = cached.operations.get(operationName);
  if (previous) return previous;
  if (!cached.document) return protectedScope;
  const operation = getOperationAST(cached.document, operationName);
  if (!operation) return protectedScope;
  const fragments = new Map(
    cached.document.definitions.flatMap((definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION
        ? [[definition.name.value, definition] as const]
        : []
    )
  );
  const cursorFields = new Set<CursorField>();
  const compile = (
    selectionSet: SelectionSetNode,
    visiting = new Set<string>(),
    path: readonly string[] = []
  ): ScopeCheck => {
    const checks = selectionSet.selections.map((selection): ScopeCheck => {
      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        const fragment = fragments.get(name);
        if (
          !fragment ||
          visiting.has(name) ||
          protectedType.test(fragment.typeCondition.name.value)
        )
          return () => true;
        return compile(
          fragment.selectionSet,
          new Set([...visiting, name]),
          path
        );
      }
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        if (
          selection.typeCondition &&
          protectedType.test(selection.typeCondition.name.value)
        )
          return () => true;
        return compile(selection.selectionSet, visiting, path);
      }
      const name = selection.name.value;
      if (independentFields.has(name)) return () => false;
      if (
        operation.operation === 'mutation' &&
        path.length === 0 &&
        independentEmailMutations.has(name)
      )
        return () => false;
      const args = (variables: Record<string, unknown>) =>
        Object.fromEntries(
          (selection.arguments ?? []).map((arg) => [
            arg.name.value,
            valueFromASTUntyped(arg.value, variables),
          ])
        );
      if (
        operation.operation === 'mutation' &&
        path.length === 0 &&
        name === 'moveEntities'
      )
        return (variables) => {
          const inputs = args(variables).inputs;
          const moves = Array.isArray(inputs) ? inputs : [inputs];
          // Moves return only the moved entity and its old/new folders. Email
          // moves additionally require Owner in update_thread_project, so a
          // CRM-only grant cannot produce an email snapshot here.
          return moves.some(
            (input) =>
              ![
                'DOCUMENT',
                'PROJECT',
                'CHAT',
                'DATABASE',
                'FORM',
                'EMAIL_THREAD',
              ].includes(String(object(object(input).entity).type))
          );
        };
      if (name === 'soupEntity')
        return (variables, allowWitnesses = true) => {
          const input = object(args(variables).input);
          return (
            !unrelatedEntityTypes.has(String(input.entityType)) &&
            !(
              allowWitnesses &&
              input.entityType === 'EMAIL_THREAD' &&
              hasOwnedEmailWitness(input.entityId ?? input.id)
            )
          );
        };
      if (name === 'emailThread')
        return (variables, allowWitnesses = true) =>
          !allowWitnesses ||
          !hasOwnedEmailWitness(object(args(variables).input).threadId);
      if (name === 'soup' || name === 'groupSoup') {
        const fields = selection.selectionSet?.selections ?? [];
        let cursorFieldsSelection = fields;
        if (name === 'groupSoup') {
          const bins = fields.find(
            (field) =>
              field.kind === Kind.FIELD &&
              !field.alias &&
              field.name.value === 'bins'
          );
          cursorFieldsSelection =
            bins?.kind === Kind.FIELD
              ? (bins.selectionSet?.selections ?? [])
              : [];
        }
        const exposesCursor =
          path.length === 1 &&
          path[0] === 'user' &&
          !selection.alias &&
          cursorFieldsSelection.some(
            (field) =>
              field.kind === Kind.FIELD &&
              !field.alias &&
              field.name.value === 'nextCursor'
          );
        if (exposesCursor) cursorFields.add(name);
        return (variables, allowWitnesses = true) => {
          const input = object(args(variables).input);
          if (input.initial !== undefined)
            return !excludesCrmContent(object(input.initial).filters);
          return (
            !allowWitnesses ||
            !exposesCursor ||
            !hasCursorWitness(
              query,
              operation.name?.value,
              name,
              object(input.continuation)
            )
          );
        };
      }
      if (
        name === 'setEntityProperty' ||
        name === 'updateEntityPropertyOptions'
      )
        return (variables) =>
          !unrelatedEntityTypes.has(
            String(object(args(variables).input).entityType)
          );
      if (name === 'propertyDefinitions')
        return (variables) =>
          !['SYSTEM', 'USER', 'TEAM'].includes(String(args(variables).scope));
      if (name === 'savedViews')
        return (variables) =>
          typeof args(variables).kind !== 'string' ||
          ['crm', 'crm-list'].includes(String(args(variables).kind));
      if (protectedFields.has(name)) return () => true;
      return selection.selectionSet
        ? compile(selection.selectionSet, visiting, [
            ...path,
            selection.alias?.value ?? name,
          ])
        : () => false;
    });
    return (variables, allowWitnesses = true) =>
      checks.some((check) => check(variables, allowWitnesses));
  };
  const result = {
    check: compile(operation.selectionSet),
    kind: operation.operation,
    operationName: operation.name?.value,
    cursorFields,
  };
  cached.operations.set(operationName, result);
  return result;
}

/** Only these selected, unaliased response shapes can establish a cursor witness. */
export function queryExposesSoupCursors(query: string, operationName?: string) {
  const scope = compiledScope(query, operationName);
  return scope.kind === 'query' && !!scope.cursorFields?.size;
}

/** Called only after an owner-tagged cached read; never infer scope from cursor text. */
export function rememberSoupContinuations(
  request: {
    query: string;
    operationName?: string;
    variables?: Record<string, unknown>;
  },
  data: unknown,
  account: string,
  isCurrent: () => boolean
) {
  const scope = compiledScope(request.query, request.operationName);
  if (
    scope.kind !== 'query' ||
    scope.check(request.variables ?? {}) ||
    !isCurrent()
  )
    return;
  const user = object(object(data).user);
  if (user.id !== account) return;
  const remember = (cursor: unknown, field: CursorField, groupKey?: string) => {
    rememberCursor(cursor, {
      query: request.query,
      operationName: scope.operationName,
      field,
      groupKey,
      isCurrent,
    });
  };
  if (scope.cursorFields?.has('soup'))
    remember(object(user.soup).nextCursor, 'soup');
  if (scope.cursorFields?.has('groupSoup')) {
    const bins = object(user.groupSoup).bins;
    if (Array.isArray(bins))
      for (const bin of bins.slice(0, MAX_CURSOR_WITNESSES)) {
        const value = object(bin);
        if (typeof value.key === 'string')
          remember(value.nextCursor, 'groupSoup', value.key);
      }
  }
}

export function queryOperationKind(query: string, operationName?: string) {
  return compiledScope(query, operationName).kind;
}

function ownershipSelection(value: Record<string, unknown>): boolean {
  if (
    typeof value.document !== 'string' ||
    typeof value.fragmentName !== 'string'
  )
    return false;
  const fragment = cachedDocument(value.document).document?.definitions.find(
    (definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION &&
      definition.name.value === value.fragmentName
  );
  return (
    fragment?.kind === Kind.FRAGMENT_DEFINITION &&
    fragment.typeCondition.name.value === 'GraphqlSoupEmailThread' &&
    fragment.selectionSet.selections.every(
      (selection) =>
        selection.kind === Kind.FIELD &&
        !selection.selectionSet &&
        ['__typename', 'id', 'ownerId'].includes(selection.name.value)
    )
  );
}

/** Resolve each field's own arguments, including aliases and literal inputs. */
export function queryNeedsCrmProof(
  query: string,
  variables: Record<string, unknown> = {},
  operationName?: string
): boolean {
  return compiledScope(query, operationName).check(variables);
}

/** A mounted result can outlive its variables and temporary ownership witnesses. */
export function queryNeedsCrmRetirement(
  query: string,
  variables: Record<string, unknown> = {}
): boolean {
  return compiledScope(query).check(variables, false);
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
  if (kind === 'read-records-by-keys') {
    if (
      Array.isArray(value.keys) &&
      value.keys.every(
        (key) =>
          typeof key === 'string' && key.startsWith('GraphqlSoupEmailThread:')
      ) &&
      ownershipSelection(value)
    )
      return false;
    return !Array.isArray(value.keys) || value.keys.some(protectedKey);
  }
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
