import { refreshActiveGraphqlSoupQueries } from './active-queries';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function filtersByImportance(node: unknown): boolean {
  if (!isRecord(node)) return false;
  if (isRecord(node.l) && typeof node.l.Importance === 'boolean') return true;
  const and = node['&'];
  const or = node['|'];
  return (
    (Array.isArray(and) && and.some(filtersByImportance)) ||
    (Array.isArray(or) && or.some(filtersByImportance)) ||
    filtersByImportance(node['!'])
  );
}

/** Sender filter writes return the rule, so the cache needs fresh server
 * membership for lists that use the recomputed thread classification. */
export function revalidateMailImportanceLists(): Promise<void> {
  return refreshActiveGraphqlSoupQueries({
    where: (body) => isRecord(body) && filtersByImportance(body.ef),
  });
}
