import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import CopyIcon from '@icon/system/regular/copy.svg';
import { Button, CopyButton, Input } from '@ui';
import {
  createMemo,
  createRenderEffect,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import type { RoutineWebhookState } from '../core/webhook';

async function copy(text: string) {
  const copied = await writeClipboardData({ 'text/plain': text });
  if (!copied) toast.failure('Could not copy to the clipboard.');
  return copied;
}

/** How to call the URL, for the person to paste into a terminal or script. */
function curlExample(url: string) {
  return `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  --data '{"status": "failed", "service": "api"}'`;
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function CopyRow(props: { label: string; value: string }) {
  return (
    <div class="flex min-w-0 gap-2">
      <Input
        readOnly
        value={props.value}
        aria-label={props.label}
        class="min-w-0 font-mono text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <CopyButton
        aria-label={`Copy ${props.label.toLowerCase()}`}
        tooltip={`Copy ${props.label.toLowerCase()}`}
        variant="secondary"
        size="sm"
        onClick={() => copy(props.value)}
      >
        <CopyIcon class="size-3.5" />
        Copy
      </CopyButton>
    </div>
  );
}

/**
 * A webhook trigger's secret URL: made once the routine is saved, shown in
 * full only right after it is made, then replaced or deleted.
 */
export function RoutineWebhookUrl(props: {
  /** Undefined until the routine is saved with a webhook trigger. */
  state: RoutineWebhookState | undefined;
}) {
  // Loads once per saved panel: the state changes with every read, but
  // a reload would drop the secret shown since the last one.
  const saved = createMemo(() => props.state !== undefined);
  createRenderEffect(
    on(saved, (saved) => {
      if (saved) props.state?.load();
    })
  );
  return (
    <div class="grid min-w-0 gap-2">
      <span class="text-xs font-medium text-ink-muted">Webhook URL</span>
      <Switch>
        <Match when={!props.state}>
          <p class="text-xs text-ink-muted">
            Add this trigger and save the routine to get its URL.
          </p>
        </Match>
        <Match when={props.state?.created}>
          {(created) => (
            <div class="grid min-w-0 gap-2">
              <CopyRow label="Webhook URL" value={created().url} />
              <p class="text-xs text-ink-muted">
                Copy it now; it won’t be shown again. Anyone with this URL can
                run this routine with what they send. JSON bodies reach code
                steps as{' '}
                <code class="font-mono">trigger.item.webhook.json</code>.
              </p>
              <div class="grid min-w-0 gap-1">
                <div class="flex items-center justify-between text-xs font-medium text-ink-muted">
                  Example
                  <CopyButton
                    aria-label="Copy example"
                    tooltip="Copy example"
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(curlExample(created().url))}
                  >
                    <CopyIcon class="size-3.5" />
                    Copy
                  </CopyButton>
                </div>
                <pre class="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg border border-edge-frame bg-control px-3 py-2 font-mono text-xs text-ink">
                  {curlExample(created().url)}
                </pre>
              </div>
              <details class="grid gap-2 text-xs text-ink-muted">
                <summary>Keep the secret out of the URL</summary>
                <p class="py-1">
                  POST to this address with the header{' '}
                  <code class="font-mono">Authorization: Bearer</code> and the
                  secret instead, so it stays out of logs that record URLs.
                </p>
                <CopyRow label="Address" value={created().bearerUrl} />
                <CopyRow label="Secret" value={created().secret} />
              </details>
            </div>
          )}
        </Match>
        <Match when={props.state?.webhook}>
          {(webhook) => (
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 text-xs text-ink-muted">
                Made {day(webhook().createdAt)}
                <Show when={webhook().lastUsedAt} fallback={', not used yet'}>
                  {(used) => `, last used ${day(used())}`}
                </Show>
                . A new URL stops this one working.
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={props.state?.pending}
                onClick={() => props.state?.create()}
              >
                New URL
              </Button>
              <Button
                variant="danger-ghost"
                size="sm"
                disabled={props.state?.pending}
                onClick={() => props.state?.remove()}
              >
                Delete URL
              </Button>
            </div>
          )}
        </Match>
        <Match when={props.state?.webhook === null}>
          <div class="flex flex-wrap items-center gap-2">
            <p class="min-w-0 flex-1 text-xs text-ink-muted">
              POST text or JSON to this routine’s URL to run it with what you
              send.
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={props.state?.pending}
              onClick={() => props.state?.create()}
            >
              Create URL
            </Button>
          </div>
        </Match>
      </Switch>
      <Show when={props.state?.failed}>
        <p role="alert" class="text-xs text-failure">
          Something went wrong with the webhook URL. Try again.
        </p>
      </Show>
    </div>
  );
}
