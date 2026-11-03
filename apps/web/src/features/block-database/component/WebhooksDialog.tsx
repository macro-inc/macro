import { fireAndForget } from '@core/util/fireAndForget';
import CopyIcon from '@icon/system/regular/copy.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Telemetry } from '@macro-inc/observability';
import { databaseWebhookUrl } from '@service-storage/databases';
import type { DatabaseWebhookResponse } from '@service-storage/generated/schemas/databaseWebhookResponse';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { Button } from '@ui/components/Button';
import { CopyButton } from '@ui/components/CopyButton';
import { Dialog } from '@ui/components/Dialog';
import { Input } from '@ui/components/Input';
import { Panel } from '@ui/components/Panel';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
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
  const { webhooks, failed, ready } = useTableWebhooks(
    () => props.databaseId,
    () => props.table.table.id
  );
  const [created, setCreated] = createSignal<CreatedWebhook>();
  const [pending, setPending] = createSignal(false);
  let initialCreationHandled = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const example = () =>
    webhookExamplePayload(
      props.table.columns.map(toViewColumn),
      new Date().toISOString().slice(0, 10)
    );

  async function create() {
    if (pending()) return;
    initialCreationHandled = true;
    setPending(true);
    const databaseId = props.databaseId;
    const tableId = props.table.table.id;
    const result = await Telemetry.span(
      'database.webhook.create',
      async (span) => {
        span.setAttr('database.id', databaseId);
        span.setAttr('table.id', tableId);
        const result = await createTableWebhook(databaseId, tableId);
        if (result.isErr()) span.error('Could not create a webhook');
        return result;
      }
    );
    if (disposed) return;
    setPending(false);
    if (props.databaseId !== databaseId || props.table.table.id !== tableId)
      return;
    result.match(setCreated, () =>
      toast.failure('Could not create a webhook.')
    );
  }

  createEffect(
    on(
      () => (ready() ? webhooks() : undefined),
      (loaded) => {
        if (loaded === undefined || initialCreationHandled) return;
        initialCreationHandled = true;
        if (loaded.length === 0) {
          fireAndForget(create(), 'database-webhooks');
        }
      }
    )
  );

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
      onOpenChange={(open) => !open && !pending() && props.onClose()}
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
                          aria-label="Copy webhook URL"
                          tooltip="Copy webhook URL"
                          variant="secondary"
                          onClick={() => copy(url())}
                        >
                          <CopyIcon class="size-4" />
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
                          aria-label="Copy example"
                          tooltip="Copy example"
                          size="sm"
                          variant="ghost"
                          onClick={() => copy(curl())}
                        >
                          <CopyIcon class="size-3.5" />
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
                        aria-label="Delete webhook"
                        tooltip="Delete webhook"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          fireAndForget(remove(webhook), 'database-webhooks')
                        }
                      >
                        <TrashIcon class="size-4" />
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Done
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pending()}
                onClick={() => fireAndForget(create(), 'database-webhooks')}
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
