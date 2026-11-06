import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import { recordSessionCacheWrite } from '@graphql-cache/lifecycle';
import { captureCacheWriteSession } from '@graphql-cache/session-writes';
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
  const session = captureCacheWriteSession();
  const client = getGraphqlSoupClient();
  const host = getGraphqlSoupCacheHost();
  const isCurrent = () =>
    session.isCurrent() &&
    client === getGraphqlSoupClient() &&
    host === getGraphqlSoupCacheHost();
  return {
    isCurrent,
    async invalidate(contactId: string) {
      await session.run(async () => {
        if (!host || host.disabled || !isCurrent()) return;
        recordExternalWrite(host, ['GraphqlSoupCrmContact']);
        try {
          await host.deleteRecords([`GraphqlSoupCrmContact:${contactId}`]);
        } catch (error) {
          Telemetry.error(error);
        }
      });
    },
    async commit(contact: CrmContactResponse, companyName: string | null) {
      await session.run(async () => {
        if (!host || host.disabled || !isCurrent()) return;
        recordExternalWrite(host, ['GraphqlSoupCrmContact']);
        try {
          recordSessionCacheWrite(host, `GraphqlSoupCrmContact:${contact.id}`);
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
      });
    },
  };
}
