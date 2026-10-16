import CopyIcon from '@phosphor/copy.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import { databaseWebhookUrl } from '@service-storage/databases';
import type { DatabaseWebhookResponse } from '@service-storage/generated/schemas/databaseWebhookResponse';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { Button } from '@ui/components/Button';
import { CopyButton } from '@ui/components/CopyButton';
import { Dialog } from '@ui/components/Dialog';
import { Input } from '@ui/components/Input';
import { Panel } from '@ui/components/Panel';
import { createSignal, For, Show } from 'solid-js';
import { toast } from '../../../lib/core/component/Toast/Toast';
import { toViewColumn } from '../../database/queries/column-detail';
import { webhookCurl, webhookExamplePayload } from '../core/webhook-example';
import {
  createTableWebhook,
  deleteTableWebhook,
  useTableWebhooks,
} from '../queries/webhooks';

/** A webhook just created, with the token that is shown only now. */
type CreatedWebhook = { webhook: DatabaseWebhookResponse; token: string };

function copy(text: string) {
  return navigator.clipboard.writeText(text).catch(() => {
    toast.failure('Could not copy to the clipboard.');
    return false as const;
  });
}

/** Webhooks that insert rows into one table: create one, copy its URL, delete old ones. */
export function WebhooksDialog(props: {
  databaseId: string;
  table: TableDetail;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const { webhooks, failed } = useTableWebhooks(
    () => props.databaseId,
    () => props.table.table.id
  );
  const [created, setCreated] = createSignal<CreatedWebhook>();
  const [pending, setPending] = createSignal(false);
  const example = () =>
    webhookExamplePayload(
      props.table.columns.map(toViewColumn),
      new Date().toISOString().slice(0, 10)
    );

  async function create() {
    if (pending()) return;
    setPending(true);
    const result = await createTableWebhook(
      props.databaseId,
      props.table.table.id
    );
    setPending(false);
    result.match(setCreated, () =>
      toast.failure('Could not create a webhook.')
    );
  }

  async function remove(webhook: DatabaseWebhookResponse) {
    const result = await deleteTableWebhook(props.databaseId, webhook.id);
    result.match(
      () => {
        if (created()?.webhook.id === webhook.id) setCreated(undefined);
      },
      () => toast.failure('Could not delete this webhook.')
    );
  }

  return (
    <Dialog
      open
      class="w-160 max-w-[calc(100vw-2rem)]"
      onOpenChange={(open) => !open && props.onClose()}
      onCloseAutoFocus={(event) => {
        if (props.returnFocus?.isConnected) {
          event.preventDefault();
          props.returnFocus.focus();
        }
      }}
    >
      <Panel>
        <Panel.Body>
          <div class="flex min-w-0 flex-col gap-4 p-5">
            <div>
              <Dialog.Title class="text-base font-semibold">
                Webhooks
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-ink-muted">
                POST JSON to a webhook URL to add a row to “
                {props.table.table.name}”. Keys are column names; send an array
                to add several rows.
              </Dialog.Description>
            </div>
            <Show when={created()}>
              {(fresh) => {
                const url = () => databaseWebhookUrl(fresh().token);
                const curl = () => webhookCurl(url(), example());
                return (
                  <div class="flex flex-col gap-3">
                    <label class="flex flex-col gap-1.5 text-sm">
                      Webhook URL
                      <div class="flex gap-2">
                        <Input
                          readOnly
                          value={url()}
                          class="font-mono text-xs"
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <CopyButton
                          variant="outline"
                          label="Copy webhook URL"
                          onClick={() => copy(url())}
                        >
                          <CopyIcon />
                          Copy
                        </CopyButton>
                      </div>
                    </label>
                    <p class="text-xs text-ink-muted">
                      Copy it now; it won't be shown again. Anyone with this URL
                      can add rows, writing as you.
                    </p>
                    <div class="flex flex-col gap-1.5 text-sm">
                      <div class="flex items-center justify-between">
                        Example
                        <CopyButton
                          size="sm"
                          variant="ghost"
                          label="Copy example"
                          onClick={() => copy(curl())}
                        >
                          <CopyIcon />
                          Copy
                        </CopyButton>
                      </div>
                      <pre class="max-h-56 overflow-auto rounded-md border border-edge-muted bg-canvas-base p-3 text-xs">
                        {curl()}
                      </pre>
                    </div>
                  </div>
                );
              }}
            </Show>
            <Show when={failed()}>
              <p class="text-sm text-failure" role="alert">
                Could not load this table's webhooks.
              </p>
            </Show>
            <Show when={webhooks()?.length}>
              <ul class="flex flex-col divide-y divide-edge-muted rounded-md border border-edge-muted text-sm">
                <For each={webhooks()}>
                  {(webhook) => (
                    <li class="flex items-center gap-3 px-3 py-2">
                      <span class="font-mono text-xs">
                        {webhook.tokenPrefix}…
                      </span>
                      <span class="flex-1 text-xs text-ink-muted">
                        Created{' '}
                        {new Date(webhook.createdAt).toLocaleDateString()}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        label="Delete webhook"
                        onClick={() => void remove(webhook)}
                      >
                        <TrashIcon class="size-4" />
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={props.onClose}>
                Done
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={pending()}
                onClick={() => void create()}
              >
                {pending() ? 'Creating…' : 'Create webhook'}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
