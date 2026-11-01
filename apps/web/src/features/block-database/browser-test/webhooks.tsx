import '@app/index.css';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseWebhookResponse } from '@service-storage/generated/schemas/databaseWebhookResponse';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui/components/Button';
import { okAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { WebhooksDialog } from '../component/WebhooksDialog';

const table: TableDetail = {
  table: {
    id: 'table',
    database_id: 'database',
    name: 'Contacts',
    position: 'a',
    version: 1,
  },
  columns: [],
  views: [],
  sql_name: '"Contacts"',
};
let webhooks: DatabaseWebhookResponse[] = [];
const [creations, setCreations] = createSignal(0);
storageServiceClient.databases.listWebhooks = () =>
  okAsync({ webhooks: [...webhooks] });
storageServiceClient.databases.createWebhook = () => {
  setCreations((count) => count + 1);
  const webhook: DatabaseWebhookResponse = {
    id: `webhook-${creations()}`,
    databaseId: 'database',
    tableId: 'table',
    createdBy: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    tokenPrefix: `example-${creations()}`,
  };
  webhooks.push(webhook);
  return okAsync({ webhook, token: `example-token-${creations()}` });
};
storageServiceClient.databases.deleteWebhook = ({ webhookId }) => {
  webhooks = webhooks.filter((webhook) => webhook.id !== webhookId);
  return okAsync({});
};
function Fixture() {
  const [open, setOpen] = createSignal(false);
  let opener: HTMLButtonElement | undefined;
  return (
    <QueryClientProvider client={queryClient}>
      <Button ref={opener} onClick={() => setOpen(true)}>
        Webhooks
      </Button>
      <output aria-label="Creations">{creations()}</output>
      <Show when={open()}>
        <WebhooksDialog
          databaseId="database"
          table={table}
          onClose={() => setOpen(false)}
          returnFocus={opener}
        />
      </Show>
    </QueryClientProvider>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
