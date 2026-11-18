import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import { Telemetry } from '@macro-inc/observability';
import { stringifyDocument } from '@urql/core';
import {
  CrmVisibilityCacheWriteDocument,
  type CrmVisibilityCacheWriteSubscription,
} from './graphql/generated/graphql';
import { getGraphqlSoupCacheHost, getGraphqlSoupClient } from './graphql-soup';

/** Capture the session before REST dispatch; a late response cannot enter a new session. */
export function prepareCrmVisibilityWrite() {
  const client = getGraphqlSoupClient();
  const host = getGraphqlSoupCacheHost();
  const isCurrent = () =>
    client === getGraphqlSoupClient() && host === getGraphqlSoupCacheHost();
  return {
    isCurrent,
    async commit(change: {
      companyId?: string;
      contactIds: string[];
      hidden: boolean;
    }) {
      if (!isCurrent() || !host) return;
      recordExternalWrite(
        host,
        change.companyId
          ? ['GraphqlSoupCrmCompany', 'GraphqlSoupCrmContact']
          : ['GraphqlSoupCrmContact']
      );
      const items: CrmVisibilityCacheWriteSubscription['soupUpdates'] =
        change.contactIds.map((id) => ({
          __typename: 'SoupUpdated',
          item: {
            __typename: 'GraphqlSoupCrmContact',
            id,
            hidden: change.hidden,
          },
        }));
      if (change.companyId)
        items.push({
          __typename: 'SoupUpdated',
          item: {
            __typename: 'GraphqlSoupCrmCompany',
            id: change.companyId,
            hidden: change.hidden,
          },
        });
      try {
        await host.writeQuery({
          query: stringifyDocument(CrmVisibilityCacheWriteDocument),
          operationName: 'CrmVisibilityCacheWrite',
          data: {
            soupUpdates: items,
          } satisfies CrmVisibilityCacheWriteSubscription,
        });
      } catch (error) {
        Telemetry.error(error);
        // Confirmed writes stay successful even if the local cache is unavailable.
        if (isCurrent()) {
          try {
            await host.deleteRecords(
              items.flatMap((item) =>
                item.__typename === 'SoupUpdated' && 'id' in item.item
                  ? [`${item.item.__typename}:${item.item.id}`]
                  : []
              )
            );
          } catch (error) {
            Telemetry.error(error);
          }
        }
      }
    },
  };
}
