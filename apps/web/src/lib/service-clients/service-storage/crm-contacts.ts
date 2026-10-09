import type { SearchCursor } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import {
  CrmContactsDocument,
  type GraphqlCrmContactExpr,
} from './graphql/generated/graphql';
import { getGraphqlSoupCacheHost, getGraphqlSoupClient } from './graphql-soup';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Lists deduplicated contacts from every CRM-enabled team the viewer can access. */
export async function fetchCrmContacts(options: {
  cursor?: string | null;
  search?: string;
  limit: number;
  signal?: AbortSignal;
}) {
  const filter: GraphqlCrmContactExpr = {
    and: {
      left: { literal: { hidden: false } },
      right: {
        literal: options.search?.trim()
          ? { search: options.search.trim() }
          : { include: true },
      },
    },
  };
  const result = await getGraphqlSoupClient()
    .query(
      CrmContactsDocument,
      {
        input: options.cursor
          ? { continuation: { cursor: options.cursor } }
          : {
              initial: {
                limit: options.limit,
                sortMethod: 'UPDATED_AT',
                filters: {
                  documentFilter: { literal: { id: NIL_UUID } },
                  chatFilter: { literal: { chatId: NIL_UUID } },
                  projectFilter: { literal: { projectIdSelf: NIL_UUID } },
                  emailFilter: { tree: { literal: { threadId: NIL_UUID } } },
                  channelFilter: { literal: { channelId: NIL_UUID } },
                  channelThreadFilter: { literal: { threadId: NIL_UUID } },
                  callFilter: { literal: { callId: NIL_UUID } },
                  calendarEventFilter: { literal: { id: NIL_UUID } },
                  foreignEntityFilter: { literal: { id: NIL_UUID } },
                  crmCompanyFilter: { literal: { id: NIL_UUID } },
                  crmContactFilter: filter,
                },
              },
            },
      },
      {
        requestPolicy: 'network-only',
        fetchOptions: { signal: options.signal },
      }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Contact query returned no data');
  const page = result.data.user.soup;
  return {
    contacts: page.items.flatMap((item) =>
      item.__typename === 'GraphqlSoupCrmContact' ? [item] : []
    ),
    nextCursor: page.nextCursor,
  };
}

/** Evict derived suggestions before reloading REST-mutated contact facts. */
export async function invalidateCachedCrmContacts(
  contactId?: string
): Promise<void> {
  try {
    const host = getGraphqlSoupCacheHost();
    if (!host) return;
    if (contactId) {
      await host.deleteRecords([`GraphqlSoupCrmContact:${contactId}`]);
      return;
    }
    // Company visibility, company names, and CRM enablement affect cached contacts.
    const keys: string[] = [];
    let cursor: SearchCursor | undefined;
    do {
      const page = await host.search({
        profile: 'quick-access-v1',
        buckets: ['crm_contact'],
        limit: 500,
        cursor,
      });
      keys.push(...page.documents.map((document) => document.recordKey));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    for (let offset = 0; offset < keys.length; offset += 500) {
      await host.deleteRecords(keys.slice(offset, offset + 500));
    }
  } catch (error) {
    // Local cache failure must not turn a successful REST mutation into a
    // failure or prevent its normal server-state queries from refreshing.
    Telemetry.error(error);
  }
}
