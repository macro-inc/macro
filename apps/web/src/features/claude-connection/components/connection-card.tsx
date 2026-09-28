import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import { Button, confirmDialog } from '@ui';
import { createUniqueId, Show } from 'solid-js';
import type { ClaudeConnectionStatus, ClaudeLogin } from '../core/connection';

export type ConnectionCardProps = {
  status?: ClaudeConnectionStatus;
  failed: boolean;
  login?: ClaudeLogin;
  code: string;
  busy: boolean;
  error: string;
  onCode: (code: string) => void;
  onBegin: () => void;
  onComplete: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
};

export function ConnectionCard(props: ConnectionCardProps) {
  const inputId = createUniqueId();
  const disconnect = async () => {
    if (props.busy) return;
    const confirmed = await confirmDialog({
      title: 'Disconnect Claude?',
      body: 'Remove your Claude connection from Macro? Existing cloud sessions keep running. You can reconnect at any time.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (confirmed && !props.busy) props.onDisconnect();
  };
  return (
    <section aria-label="Claude Cloud connection" class="flex gap-4 px-6 py-5">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted">
        <AnthropicIcon class="size-5" aria-label="Anthropic" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-h-5 items-start justify-between gap-3">
          <h2 class="min-w-0 text-sm/5 font-medium text-ink">Claude Cloud</h2>
          <span
            class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[11px]/none font-medium"
            classList={{
              'bg-success-bg text-success': !!props.status?.connected,
              'bg-ink/5 text-ink-muted': !props.status?.connected,
            }}
          >
            {props.failed
              ? 'Unavailable'
              : !props.status
                ? 'Loading…'
                : props.status.connected
                  ? 'Connected'
                  : 'Not connected'}
          </span>
        </div>
        <p class="mt-1 text-sm text-ink-muted">
          Run Claude Code in the cloud using your own Claude subscription. No
          macrod required.
        </p>
        <div class="mt-3">
          <Show
            when={!props.status || props.status.enabled}
            fallback={
              <p class="text-xs text-ink-muted">
                Claude sign-in is not configured on this deployment.
              </p>
            }
          >
            <Show
              when={props.login}
              keyed
              fallback={
                <div>
                  <Button
                    size="sm"
                    disabled={props.busy || (!props.status && !props.failed)}
                    onClick={
                      props.failed
                        ? props.onRefresh
                        : props.status?.connected
                          ? () => void disconnect()
                          : props.onBegin
                    }
                  >
                    {props.failed
                      ? 'Retry connection status'
                      : props.busy
                        ? 'Working…'
                        : props.status?.connected
                          ? 'Disconnect Claude'
                          : 'Connect Claude'}
                  </Button>
                </div>
              }
            >
              {(login) => (
                <form
                  class="flex max-w-lg flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    props.onComplete();
                  }}
                >
                  <p class="text-xs text-ink-muted">
                    {props.status?.ephemeral
                      ? 'This connection is temporary. You may need to reconnect later.'
                      : 'Your connection is saved securely.'}{' '}
                    Macro never asks for your Claude password.
                  </p>
                  <a
                    class="text-sm text-accent underline"
                    href={login.authorizationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Didn't open? Open Claude sign-in ↗
                  </a>
                  <label for={inputId} class="text-sm text-ink">
                    Paste the complete one-time code from Claude
                  </label>
                  <input
                    id={inputId}
                    type="password"
                    class="settings-input w-full"
                    value={props.code}
                    onInput={(event) => props.onCode(event.currentTarget.value)}
                    placeholder="code#state"
                    autocomplete="off"
                    spellcheck={false}
                    disabled={props.busy}
                  />
                  <p class="text-xs text-ink-muted">
                    Approve access on Claude, then copy the entire code shown
                    there. This attempt expires in{' '}
                    {Math.round(login.expiresIn / 60)} minutes.
                  </p>
                  <div class="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={props.busy || !props.code.trim()}
                    >
                      {props.busy ? 'Connecting…' : 'Finish connecting'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={props.busy}
                      onClick={props.onDisconnect}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </Show>
          </Show>
        </div>
        <Show when={props.error}>
          <p role="alert" class="mt-3 text-sm text-failure">
            {props.error}
          </p>
        </Show>
        <Show when={props.failed}>
          <div>
            <p role="alert" class="mt-3 text-xs text-ink-muted">
              Could not load Claude connection. Try again.
            </p>
          </div>
        </Show>
      </div>
    </section>
  );
}
