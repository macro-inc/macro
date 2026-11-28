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

/** Reconcile network readers after the sender filter changes importance. */
export function revalidateMailImportanceLists(
  unmaintainedOnly = false
): Promise<void> {
  return refreshActiveGraphqlSoupQueries({
    where: filtersByImportance,
    unmaintainedOnly,
  });
}

function carriesAttachment(patch: SoupPatch): boolean {
  return (
    patch.__typename === 'SoupUpdated' &&
    patch.item.__typename === 'GraphqlSoupEmailThread' &&
    patch.item.attachments.length > 0
  );
}

/**
 * The local Mail projection has no attachment facts, so a list filtered by
 * attachment kind reads the server and the cache cannot place an arriving
 * thread in it. Mounted lists with that filter refetch when one arrives, and
 * after the Soup socket reconnects, since what it pushed meanwhile is lost.
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
