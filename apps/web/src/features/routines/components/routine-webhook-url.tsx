import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import CopyIcon from '@icon/system/regular/copy.svg';
import { Button, CopyButton, Input } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { RoutineWebhookState } from '../queries/webhook';

async function copy(text: string) {
  const copied = await writeClipboardData({ 'text/plain': text });
  if (!copied) toast.failure('Could not copy to the clipboard.');
  return copied;
}

/** How to call the URL, for the person to paste into a terminal or script. */
function curlExample(url: string) {
  return `curl -X POST '${url}' \\\n  -H 'Content-Type: text/plain' \\\n  --data 'Deploy to production failed'`;
}

/**
 * A webhook trigger's secret URL: made once the routine is saved, shown in
 * full only right after it is made, then replaced or deleted.
 */
export function RoutineWebhookUrl(props: {
  /** Undefined until the routine is saved. */
  state: RoutineWebhookState | undefined;
}) {
  return (
    <div class="grid gap-2">
      <span class="text-xs font-medium text-ink-muted">Webhook URL</span>
      <Switch>
        <Match when={!props.state}>
          <p class="text-xs text-ink-muted">Save the routine to get its URL.</p>
        </Match>
        <Match when={props.state?.createdUrl}>
          {(url) => (
            <div class="grid gap-2">
              <div class="flex gap-2">
                <Input
                  readOnly
                  value={url()}
                  aria-label="Webhook URL"
                  class="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton
                  aria-label="Copy webhook URL"
                  tooltip="Copy webhook URL"
                  variant="secondary"
                  size="sm"
                  onClick={() => copy(url())}
                >
                  <CopyIcon class="size-3.5" />
                  Copy
                </CopyButton>
              </div>
              <p class="text-xs text-ink-muted">
                Copy it now; it won’t be shown again. Anyone with this URL can
                run this routine with any text they send.
              </p>
              <div class="grid gap-1">
                <div class="flex items-center justify-between text-xs font-medium text-ink-muted">
                  Example
                  <CopyButton
                    aria-label="Copy example"
                    tooltip="Copy example"
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(curlExample(url()))}
                  >
                    <CopyIcon class="size-3.5" />
                    Copy
                  </CopyButton>
                </div>
                <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-edge-muted bg-canvas-base p-2 text-xs">
                  {curlExample(url())}
                </pre>
              </div>
            </div>
          )}
        </Match>
        <Match when={props.state?.webhook}>
          {(webhook) => (
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-xs">{webhook().tokenPrefix}…</span>
              <span class="flex-1 text-xs text-ink-muted">
                Made {new Date(webhook().createdAt).toLocaleDateString()}. A new
                URL stops this one working.
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
            <p class="flex-1 text-xs text-ink-muted">
              POST text to this routine’s URL to run it with that text.
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
