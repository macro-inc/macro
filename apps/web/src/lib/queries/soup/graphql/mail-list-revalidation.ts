import type { SoupUpdatesSubscription } from '@service-storage/graphql/generated/graphql';
import { refreshActiveGraphqlSoupQueries } from './active-queries';

type SoupPatch = SoupUpdatesSubscription['soupUpdates'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Whether any email literal in a filter tree, negated or not, passes `matches`. */
function someEmailLiteral(
  node: unknown,
  matches: (literal: Record<string, unknown>) => boolean
): boolean {
  if (!isRecord(node)) return false;
  if (isRecord(node.l) && matches(node.l)) return true;
  const and = node['&'];
  const or = node['|'];
  const recurse = (child: unknown) => someEmailLiteral(child, matches);
  return (
    (Array.isArray(and) && and.some(recurse)) ||
    (Array.isArray(or) && or.some(recurse)) ||
    recurse(node['!'])
  );
}

const emailFilter = (body: unknown) => (isRecord(body) ? body.ef : undefined);

const filtersByImportance = (body: unknown) =>
  someEmailLiteral(
    emailFilter(body),
    (literal) => typeof literal.Importance === 'boolean'
  );

const filtersByAttachment = (body: unknown) =>
  someEmailLiteral(
    emailFilter(body),
    (literal) => literal.Attachment !== undefined
  );

/** Sender filter writes return the rule, so the cache needs fresh server
 * membership for lists that use the recomputed thread classification. */
export function revalidateMailImportanceLists(): Promise<void> {
  return refreshActiveGraphqlSoupQueries({ where: filtersByImportance });
}

function carriesAttachment(patch: SoupPatch): boolean {
  return (
    patch.__typename === 'SoupUpdated' &&
    patch.item.__typename === 'GraphqlSoupEmailThread' &&
    patch.item.attachments.length > 0
  );
}

/**
 * A host that evaluates Mail locally keeps lists filtered by attachment kind
 * current from the threads' attachment facts. Elsewhere (the desktop app's
 * legacy Mail profile, older native builds, a cold cache) such a list reads the
 * server and the cache cannot place an arriving thread in it, so mounted lists
 * the cache does not maintain refetch when one arrives, and after the Soup
 * socket reconnects, since what it pushed meanwhile is lost.
 */
export function revalidateMailAttachmentLists(): Promise<void> {
  return refreshActiveGraphqlSoupQueries({
    where: filtersByAttachment,
    unmaintainedOnly: true,
  });
}

export async function revalidateMailAttachmentListsForSoupUpdates(
  patches: readonly SoupPatch[]
): Promise<void> {
  if (!patches.some(carriesAttachment)) return;
  await revalidateMailAttachmentLists();
}
