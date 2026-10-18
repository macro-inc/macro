import { TAG_FACET_ID } from '@app/features/soup';
import type { ListBulkThreadTargetsRequest } from '@service-email/generated/schemas';
import type { EmailTab } from '../types';
import {
  buildEmailQuery,
  type EmailQueryContext,
  emailViewForTab,
} from './email-query';

/** The part of a bulk targets request that names the view's threads. */
export type EmailBulkQuery = Pick<
  ListBulkThreadTargetsRequest,
  'ef' | 'emailView'
>;

/** Tabs whose list is one server query over the viewer's own mail. */
const BULK_TABS: readonly EmailTab[] = [
  'important',
  'noise',
  'calendar',
  'all',
  'archived',
];

/**
 * The server query behind a view's whole list, so a selection can reach rows
 * that never loaded. Undefined when the list also depends on refinement the
 * server query does not carry: search text, attachment filters (matched on
 * the client), tags and favorites (applied above the email query).
 */
export function emailBulkQuery(
  context: EmailQueryContext,
  search: string
): EmailBulkQuery | undefined {
  if (!BULK_TABS.includes(context.tab)) return;
  if (search.trim()) return;
  if ((context.facets.attachments?.length ?? 0) > 0) return;
  if ((context.facets[TAG_FACET_ID]?.length ?? 0) > 0) return;

  return {
    ef: buildEmailQuery(context).body.ef,
    emailView: emailViewForTab(context.tab),
  };
}
