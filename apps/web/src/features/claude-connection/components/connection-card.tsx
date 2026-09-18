import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import { Button } from '@ui';
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
  return (
    <section aria-label="Claude Cloud connection" class="flex gap-4 px-6 py-5">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted">
        <AnthropicIcon class="size-5" aria-label="Anthropic" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-medium text-ink">Claude Cloud</h2>
          <Show when={props.status?.connected}>
            <span class="text-xs text-success">Connected</span>
          </Show>
        </div>
        <p class="text-sm text-ink-muted">
          Run Claude Code in the cloud using your own Claude subscription. No
          macrod required.
        </p>
        <Show
          when={props.status}
          fallback={
            <p class="text-xs text-ink-muted">
              {props.failed
                ? 'Could not load Claude connection. Check that this workspace’s backend is running.'
                : 'Loading Claude connection…'}
            </p>
          }
        >
          <Show
            when={props.status?.enabled}
            fallback={
              <p class="text-xs text-ink-muted">
                Claude sign-in is not configured on this deployment.
              </p>
            }
          >
            <p class="text-xs text-ink-muted">
              {props.status?.ephemeral
                ? 'Credentials stay in server memory. Reconnect after a backend restart.'
                : 'Your connection is saved securely and survives backend restarts.'}{' '}
              Macro never asks for your Claude password.
            </p>
            <Show
              when={props.login}
              keyed
              fallback={
                <div>
                  <Button
                    size="sm"
                    disabled={props.busy}
                    onClick={
                      props.status?.connected
                        ? props.onDisconnect
                        : props.onBegin
                    }
                  >
                    {props.busy
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
        </Show>
        <Show when={props.status?.connected}>
          <p class="text-xs text-ink-muted">
            Ready. In Settings → Agents, choose Claude Cloud as the agent’s
            harness. Disconnecting forgets Macro’s grant; it does not revoke
            consent at Claude or stop an already-running cloud turn.
          </p>
        </Show>
        <Show when={props.error}>
          <p role="alert" class="text-sm text-failure">
            {props.error}
          </p>
        </Show>
        <Show when={props.failed}>
          <div>
            <Button size="sm" onClick={props.onRefresh}>
              Retry connection status
            </Button>
          </div>
        </Show>
      </div>
    </section>
  );
}
