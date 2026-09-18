import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import { Button } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
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
  const [expanded, setExpanded] = createSignal(false);
  const detailsId = createUniqueId();
  return (
    <section aria-label="Claude Cloud connection" class="px-5 py-4 mobile:px-4">
      <div class="flex items-start gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted">
          <AnthropicIcon class="size-5" aria-label="Anthropic" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 class="text-sm font-medium text-ink">Claude Cloud</h2>
              <span
                class="inline-flex items-center gap-1.5 text-[11px]"
                classList={{
                  'text-success': props.status?.connected,
                  'text-ink-extra-muted': !props.status?.connected,
                }}
              >
                <span
                  aria-hidden="true"
                  class="size-1.5 rounded-full"
                  classList={{
                    'bg-success': props.status?.connected,
                    'bg-ink-extra-muted': !props.status?.connected,
                  }}
                />
                {props.status?.connected
                  ? 'Connected'
                  : !props.status
                    ? props.failed
                      ? 'Unavailable'
                      : 'Loading…'
                    : props.status.enabled
                      ? 'Not connected'
                      : 'Unavailable'}
              </span>
            </div>
            <Show when={props.status?.enabled && !props.login}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="shrink-0"
                disabled={props.busy}
                aria-label={
                  props.status?.connected
                    ? expanded()
                      ? 'Done configuring Claude Cloud'
                      : 'Configure Claude Cloud'
                    : 'Connect Claude'
                }
                aria-expanded={props.status?.connected ? expanded() : undefined}
                aria-controls={props.status?.connected ? detailsId : undefined}
                onClick={() =>
                  props.status?.connected
                    ? setExpanded(!expanded())
                    : props.onBegin()
                }
              >
                {props.busy
                  ? 'Working…'
                  : props.status?.connected
                    ? expanded()
                      ? 'Done'
                      : 'Configure'
                    : 'Connect'}
              </Button>
            </Show>
          </div>
          <p class="mt-1 text-xs leading-5 text-ink-muted">
            Claude Code in the cloud, using your Claude subscription.
          </p>
        </div>
      </div>
      <Show when={props.status && !props.status.enabled}>
        <p class="mt-3 text-xs text-ink-muted">
          Claude sign-in is not configured on this deployment.
        </p>
      </Show>
      <Show when={props.login || (props.status?.connected && expanded())}>
        <div
          id={detailsId}
          class="mt-4 flex flex-col gap-3 border-t border-edge-muted pt-4"
        >
          <p class="text-xs leading-5 text-ink-muted">
            {props.status?.ephemeral
              ? 'Reconnect after a backend restart. Your connection is temporary.'
              : 'Your connection is saved securely.'}{' '}
            Macro never asks for your Claude password.
          </p>
          <Show when={props.login} keyed>
            {(login) => (
              <form
                class="flex max-w-lg flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!props.busy && props.code.trim()) props.onComplete();
                }}
              >
                <a
                  class="text-sm text-accent underline"
                  href={login.authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Didn't open? Open Claude sign-in ↗
                </a>
                <label for={inputId} class="text-xs font-medium text-ink">
                  Paste the complete one-time code from Claude
                </label>
                <input
                  id={inputId}
                  type="password"
                  class="settings-input ph-no-capture w-full"
                  value={props.code}
                  onInput={(event) => props.onCode(event.currentTarget.value)}
                  placeholder="code#state"
                  autocomplete="off"
                  spellcheck={false}
                  disabled={props.busy}
                />
                <p class="text-xs leading-5 text-ink-muted">
                  Approve access on Claude, then copy the entire code shown
                  there. This attempt expires in{' '}
                  {Math.round(login.expiresIn / 60)} minutes.
                </p>
                <div class="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="cta"
                    disabled={props.busy || !props.code.trim()}
                  >
                    {props.busy ? 'Connecting…' : 'Finish connecting'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={props.busy}
                    onClick={props.onDisconnect}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </Show>
          <Show when={props.status?.connected && !props.login}>
            <p class="text-xs leading-5 text-ink-muted">
              Choose Claude Cloud as the runtime when creating or editing an
              agent.
            </p>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="flex-1 basis-56 text-xs leading-5 text-ink-extra-muted">
                Disconnecting removes Macro’s access. It does not revoke consent
                at Claude or stop a cloud turn already running.
              </p>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={props.busy}
                onClick={props.onDisconnect}
              >
                Disconnect Claude
              </Button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="mt-3 text-sm text-failure">
          {props.error}
        </p>
      </Show>
      <Show when={props.failed}>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <p class="text-xs text-ink-muted">
            Could not load your Claude connection.
          </p>
          <Button size="sm" variant="outline" onClick={props.onRefresh}>
            Retry connection status
          </Button>
        </div>
      </Show>
    </section>
  );
}
