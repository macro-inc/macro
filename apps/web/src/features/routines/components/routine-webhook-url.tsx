import { Button, CopyButton } from '@ui';
import { Show } from 'solid-js';

export type RoutineWebhookUrlState =
  | { kind: 'unsaved' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      /** The start of the current token, when there is one. */
      tokenPrefix?: string;
      /** The full URL, only right after it was issued. */
      issuedUrl?: string;
      busy: boolean;
      /** The last issue or revoke failed. */
      failed: boolean;
    };

/** The routine's own URL that outside services POST JSON to. */
export function RoutineWebhookUrl(props: {
  state: RoutineWebhookUrlState;
  onIssue: () => void;
  onRevoke: () => void;
}) {
  const ready = () => (props.state.kind === 'ready' ? props.state : undefined);
  return (
    <div class="grid gap-2 rounded-md border border-edge-muted p-2 text-xs">
      <span class="font-medium">Webhook URL</span>
      <Show when={props.state.kind === 'unsaved'}>
        <p class="text-ink-muted">
          Create the routine first; its URL appears here.
        </p>
      </Show>
      <Show when={props.state.kind === 'loading'}>
        <p class="text-ink-muted">Loading…</p>
      </Show>
      <Show when={props.state.kind === 'error'}>
        <p class="text-failure">The URL couldn’t be loaded.</p>
      </Show>
      <Show when={ready()}>
        {(state) => (
          <>
            <Show
              when={state().issuedUrl}
              fallback={
                <p class="text-ink-muted">
                  {state().tokenPrefix
                    ? `A URL (${state().tokenPrefix}…) is active. It is shown only when issued; issue a new one to see it again.`
                    : 'This routine has no URL yet.'}
                </p>
              }
            >
              {(url) => (
                <>
                  <div class="flex items-center gap-1">
                    <code class="min-w-0 flex-1 truncate rounded bg-hover px-2 py-1">
                      {url()}
                    </code>
                    <CopyButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy webhook URL"
                      onClick={() => navigator.clipboard.writeText(url())}
                    />
                  </div>
                  <p class="text-ink-muted">
                    Copy it now; it won’t be shown again. Anyone with it can run
                    this routine, so keep it secret.
                  </p>
                  <code class="block whitespace-pre-wrap break-all rounded bg-hover px-2 py-1 text-ink-muted">
                    {`curl -X POST '${url()}' -H 'Content-Type: application/json' -d '{"status": "failed"}'`}
                  </code>
                </>
              )}
            </Show>
            <Show when={state().failed}>
              <p class="text-failure">That didn’t work; try again.</p>
            </Show>
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={state().busy}
                onClick={() => props.onIssue()}
              >
                {state().tokenPrefix ? 'Issue new URL' : 'Create URL'}
              </Button>
              <Show when={state().tokenPrefix}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state().busy}
                  onClick={() => props.onRevoke()}
                >
                  Turn off URL
                </Button>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
