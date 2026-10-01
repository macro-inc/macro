import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { CrmRecordScope } from '../core/record';

/** The system property that associates entities with this kind of record. */
export function crmRecordPropertyId(scope: CrmRecordScope): string {
  return match(scope.type)
    .with('company', () => SYSTEM_PROPERTY_IDS.COMPANIES)
    .with('contact', () => SYSTEM_PROPERTY_IDS.CONTACTS)
    .exhaustive();
}

/** The entity type of a reference to this kind of record. */
export function crmRecordReferenceType(
  scope: CrmRecordScope
): 'COMPANY' | 'CONTACT' {
  return match(scope.type)
    .with('company', () => 'COMPANY' as const)
    .with('contact', () => 'CONTACT' as const)
    .exhaustive();
}

type AstNode = Record<string, unknown>;

const leaf = (literal: AstNode): AstNode => ({ l: literal });
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

/** The record's Companies/Contacts reference, as a property literal. */
const associatedLiteral = (scope: CrmRecordScope): AstNode => ({
  pd: crmRecordPropertyId(scope),
  v: { er: scope.id },
});

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
 * Non-task documents associated with the record through its Companies or
 * Contacts property, plus attachments of emails exchanged with its people.
 */
export function recordFilesBody(scope: CrmRecordScope) {
  return {
    ...NO_ITEMS,
    df: {
      '&': [
        { '!': leaf({ dst: 'task' }) },
        or([leaf({ prop: associatedLiteral(scope) }), ...participants(scope)]),
      ],
    },
  };
}

/**
 * Calls associated with the record. Calls are linked to the CRM records of
 * their participants when they end, so the property alone covers both.
 */
export function recordCallsBody(scope: CrmRecordScope) {
  const { callf: _calls, ...others } = NO_ITEMS;
  return { ...others, propf: leaf(associatedLiteral(scope)) };
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
