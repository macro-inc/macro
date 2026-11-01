import { queryClient } from '@queries/client';
import { partialMatchKey, type Query } from '@tanstack/solid-query';
import { refreshActiveGraphqlSoupQueries } from './graphql/active-queries';
import { soupKeys } from './keys';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a REST AST names a CRM association literal anywhere in its tree. */
function treeNamesCrmAssociation(ast: unknown): boolean {
  if (!isRecord(ast)) return false;
  if ('l' in ast) return isRecord(ast.l) && 'crm' in ast.l;
  if (Array.isArray(ast['&'])) return ast['&'].some(treeNamesCrmAssociation);
  if (Array.isArray(ast['|'])) return ast['|'].some(treeNamesCrmAssociation);
  return treeNamesCrmAssociation(ast['!']);
}

/**
 * Whether a Soup AST body is restricted to items associated with a CRM
 * record, through the top-level scope or a document literal. Membership is
 * resolved by the server, so such lists refetch when associations change.
 */
export function hasCrmAssociation(body: unknown): boolean {
  if (!isRecord(body)) return false;
  return body.crma !== undefined || treeNamesCrmAssociation(body.df);
}

type EntityRef = { entity_type: string };

const isCrmRecord = ({ entity_type }: EntityRef) =>
  entity_type === 'crm_company' || entity_type === 'crm_contact';

/**
 * Whether a message mentions or attaches a CRM company or contact; either
 * makes the message an associated item of that record.
 */
export function messageReferencesCrmRecord(message: {
  mentions?: readonly EntityRef[];
  attachments?: readonly EntityRef[];
}): boolean {
  return (
    (message.mentions ?? []).some(isCrmRecord) ||
    (message.attachments ?? []).some(isCrmRecord)
  );
}

/** The filter body in a Soup list query key, which holds it after params. */
function keyBody(queryKey: readonly unknown[]): unknown {
  return queryKey.find(
    (part) => isRecord(part) && ('crma' in part || 'df' in part)
  );
}

/**
 * Refetch every mounted list restricted to a CRM association, on both
 * transports. Call after a CRM reference or a Companies/Contacts property
 * changes; lists without an association are left alone.
 */
export async function refreshCrmAssociatedSoupQueries(): Promise<void> {
  const prefixes = [soupKeys.astItems._def, soupKeys.groupedGroup._def];
  const predicate = (query: Query) =>
    prefixes.some((prefix) => partialMatchKey(query.queryKey, prefix)) &&
    hasCrmAssociation(keyBody(query.queryKey));
  const cached = queryClient.getQueryCache().findAll({ predicate });
  await Promise.all([
    cached.length > 0 ? queryClient.invalidateQueries({ predicate }) : null,
    refreshActiveGraphqlSoupQueries({ where: hasCrmAssociation }),
  ]);
}
