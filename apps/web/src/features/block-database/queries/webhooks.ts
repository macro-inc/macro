/** Webhooks that insert rows into a database's tables. */

import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { CreatedDatabaseWebhookResponse } from '@service-storage/generated/schemas/createdDatabaseWebhookResponse';
import type { DatabaseWebhookResponse } from '@service-storage/generated/schemas/databaseWebhookResponse';
import { useQuery } from '@tanstack/solid-query';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { databaseWebhookKeys } from './keys';

/** A table's webhooks; `undefined` until they are read. */
export function useTableWebhooks(
  databaseId: Accessor<string>,
  tableId: Accessor<string>
): {
  webhooks: Accessor<DatabaseWebhookResponse[] | undefined>;
  failed: Accessor<boolean>;
} {
  const query = useQuery(() => ({
    queryKey: databaseWebhookKeys.list(databaseId()).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.databases.listWebhooks({ id: databaseId() })
      ),
  }));
  return {
    webhooks: () =>
      query.isSuccess
        ? query.data.webhooks.filter((webhook) => webhook.tableId === tableId())
        : undefined,
    failed: () => query.isError,
  };
}

function updateList(
  databaseId: string,
  update: (webhooks: DatabaseWebhookResponse[]) => DatabaseWebhookResponse[]
) {
  queryClient.setQueryData<{ webhooks: DatabaseWebhookResponse[] }>(
    databaseWebhookKeys.list(databaseId).queryKey,
    (current) => current && { webhooks: update(current.webhooks) }
  );
}

/** Create a webhook for the table; the answer holds the token, shown only now. */
export function createTableWebhook(
  databaseId: string,
  tableId: string
): ResultAsync<CreatedDatabaseWebhookResponse, unknown> {
  return storageServiceClient.databases
    .createWebhook({ id: databaseId, tableId })
    .map((created) => {
      updateList(databaseId, (webhooks) => [...webhooks, created.webhook]);
      return created;
    });
}

/** Delete a webhook; its URL stops working. */
export function deleteTableWebhook(
  databaseId: string,
  webhookId: string
): ResultAsync<void, unknown> {
  return storageServiceClient.databases
    .deleteWebhook({ id: databaseId, webhookId })
    .map(() =>
      updateList(databaseId, (webhooks) =>
        webhooks.filter((webhook) => webhook.id !== webhookId)
      )
    );
}
