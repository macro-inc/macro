import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import { Telemetry } from '@macro-inc/observability';
import { stringifyDocument } from '@urql/core';
import type { CrmContactResponse } from './generated/schemas/crmContactResponse';
import {
  CrmContactCacheWriteDocument,
  type CrmContactCacheWriteSubscription,
} from './graphql/generated/graphql';
import { getGraphqlSoupCacheHost, getGraphqlSoupClient } from './graphql-soup';

/** Capture session identity before dispatching a contact edit over REST. */
export function prepareCrmContactEdit() {
  const client = getGraphqlSoupClient();
  const host = getGraphqlSoupCacheHost();
  const isCurrent = () =>
    client === getGraphqlSoupClient() && host === getGraphqlSoupCacheHost();
  return {
    isCurrent,
    async invalidate(contactId: string) {
      if (!host || !isCurrent()) return;
      recordExternalWrite(host, ['GraphqlSoupCrmContact']);
      try {
        await host.deleteRecords([`GraphqlSoupCrmContact:${contactId}`]);
      } catch (error) {
        Telemetry.error(error);
      }
    },
    async commit(contact: CrmContactResponse, companyName: string | null) {
      if (!host || !isCurrent()) return;
      recordExternalWrite(host, ['GraphqlSoupCrmContact']);
      try {
        await host.writeQuery({
          query: stringifyDocument(CrmContactCacheWriteDocument),
          operationName: 'CrmContactCacheWrite',
          data: {
            soupUpdates: [
              {
                __typename: 'SoupUpdated',
                item: {
                  __typename: 'GraphqlSoupCrmContact',
                  id: contact.id,
                  parentCompanyId: contact.companyId ?? null,
                  parentCompanyName: companyName,
                  emailAddress: contact.email ?? null,
                  updatedAt: contact.updatedAt,
                },
              },
            ],
          } satisfies CrmContactCacheWriteSubscription,
        });
      } catch (error) {
        Telemetry.error(error);
        // The server committed; cache repair must never turn that into a failed save.
        if (isCurrent()) {
          try {
            await host.deleteRecords([`GraphqlSoupCrmContact:${contact.id}`]);
          } catch (error) {
            Telemetry.error(error);
          }
        }
      }
    },
  };
}
