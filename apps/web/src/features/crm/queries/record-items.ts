import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import type {
  SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { CrmRecordScope } from '../core/record';

type AstNode = Record<string, unknown>;

const leaf = (literal: AstNode | string): AstNode => ({ l: literal });
const or = (nodes: AstNode[]): AstNode =>
  nodes.reduce((acc, node) => ({ '|': [acc, node] }));

/** Every soup target pinned to an id that cannot exist. */
const NO_ITEMS = {
  calf: leaf({ id: NIL_UUID }),
  df: leaf({ id: NIL_UUID }),
  chanf: leaf({ ChannelId: NIL_UUID }),
  cthf: leaf({ ThreadId: NIL_UUID }),
  cf: leaf({ cid: NIL_UUID }),
  pf: leaf({ pid: NIL_UUID }),
  callf: leaf({ CallId: NIL_UUID }),
  ccf: leaf({ id: NIL_UUID }),
  fef: leaf({ id: NIL_UUID }),
  ef: leaf({ ThreadId: NIL_UUID }),
};

/**
 * The record as a Soup CRM association: items whose Companies or Contacts
 * property names it, or that reference it. A company also matches through
 * every one of its contacts; the server expands and authorizes the record.
 */
export function crmAssociation(scope: CrmRecordScope) {
  return match(scope)
    .with({ type: 'company' }, ({ id }) => ({ company: id }))
    .with({ type: 'contact' }, ({ id }) => ({ contact: id }))
    .exhaustive();
}

/** Email addresses or domains of the people at the record. */
const participants = (scope: CrmRecordScope): AstNode[] =>
  match(scope)
    .with({ type: 'company' }, ({ domains }) =>
      domains.map((domain) => leaf({ eap: { Domain: domain } }))
    )
    .with({ type: 'contact' }, ({ email }) => [
      leaf({ eap: { Complete: email } }),
    ])
    .exhaustive();

/**
 * Non-task documents associated with the record, plus attachments of emails
 * exchanged with its people.
 */
export function recordFilesBody(scope: CrmRecordScope) {
  return {
    ...NO_ITEMS,
    df: {
      '&': [
        { '!': leaf({ dst: 'task' }) },
        or([leaf({ crm: crmAssociation(scope) }), ...participants(scope)]),
      ],
    },
  };
}

/**
 * Calls associated with the record. Calls are linked to the CRM records of
 * their participants when they end, and call threads can mention the record.
 */
export function recordCallsBody(scope: CrmRecordScope) {
  const { callf: _calls, ...others } = NO_ITEMS;
  return { ...others, crma: crmAssociation(scope) };
}

/**
 * Items of any type associated with the record: files, tasks, chats,
 * projects, email threads, channels, channel messages, calls, events, and
 * other CRM records whose discussions reference it. Initiatives and database
 * rows are opt-in Soup sources this body does not request.
 */
export function recordReferencesBody(scope: CrmRecordScope) {
  return {
    crma: crmAssociation(scope),
    crmf: leaf('include'),
    emailView: 'all' as const,
  };
}

/**
 * How a failed record list presents. A failed continuation page keeps the
 * loaded rows and retries that page. Any other failure, including a refetch
 * after the record became inaccessible, means the loaded rows are no longer
 * current: the list shows the failure and retries the query.
 */
export function recordListFailure(
  source: Pick<SoupAstItemsQuery, 'error' | 'isFetchNextPageError'>
) {
  const failed = source.error != null;
  return {
    isError: failed && !source.isFetchNextPageError,
    isFetchNextPageError: failed && source.isFetchNextPageError,
  };
}

const PARAMS = { limit: 100, sort_method: 'updated_at' } as const;

/** Files associated with a CRM record, via `/soup/ast`. */
export function useRecordFilesQuery(
  createQuery: typeof useSoupAstItemsQuery,
  scope: Accessor<CrmRecordScope | undefined>
) {
  return createQuery(
    () => {
      const current = scope();
      return {
        params: PARAMS,
        body: current ? recordFilesBody(current) : NO_ITEMS,
      };
    },
    () => ({ enabled: !!scope() })
  );
}

/** Items of any type associated with a CRM record, via `/soup/ast`. */
export function useRecordReferencesQuery(
  createQuery: typeof useSoupAstItemsQuery,
  scope: Accessor<CrmRecordScope | undefined>
) {
  return createQuery(
    () => {
      const current = scope();
      return {
        params: PARAMS,
        body: current ? recordReferencesBody(current) : NO_ITEMS,
      };
    },
    () => ({ enabled: !!scope() })
  );
}

/** Calls associated with a CRM record, via `/soup/ast`. */
export function useRecordCallsQuery(
  createQuery: typeof useSoupAstItemsQuery,
  scope: Accessor<CrmRecordScope | undefined>
) {
  return createQuery(
    () => {
      const current = scope();
      return {
        params: PARAMS,
        body: current ? recordCallsBody(current) : NO_ITEMS,
      };
    },
    () => ({ enabled: !!scope() })
  );
}
