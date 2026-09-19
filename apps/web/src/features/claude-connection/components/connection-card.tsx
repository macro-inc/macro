import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import { Button } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { RuntimeRow } from '../../settings/runtimes/components/runtime-row';
import { RuntimeSettingsDialog } from '../../settings/runtimes/components/runtime-settings-dialog';
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
  let trigger: HTMLButtonElement | undefined;
  const inputId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <RuntimeRow
        triggerRef={(element) => {
          trigger = element;
        }}
        name="Claude Cloud"
        system
        description="Claude Code in the cloud, using your Claude subscription."
        icon={<AnthropicIcon aria-label="Anthropic" />}
        connected={props.status?.connected}
        status={
          props.status?.connected
            ? 'Connected'
            : !props.status
              ? props.failed
                ? 'Unavailable'
                : 'Loading…'
              : props.status.enabled
                ? props.login
                  ? 'Sign-in pending'
                  : 'Not connected'
                : 'Unavailable'
        }
        actionLabel={
          props.status?.connected
            ? 'Configure'
            : props.login
              ? 'Continue'
              : 'Connect'
        }
        onConfigure={() => setOpen(true)}
      />
      <Show when={open()}>
        <RuntimeSettingsDialog
          returnFocus={() => trigger}
          title="Claude Cloud"
          description="Use your Claude subscription to run Claude Code in Macro."
          busy={props.busy}
          onClose={() => setOpen(false)}
        >
          <Show when={!props.status && !props.failed}>
            <p class="text-xs text-ink-muted">Loading Claude connection…</p>
          </Show>
          <Show when={props.status && !props.status.enabled}>
            <p class="text-xs text-ink-muted">
              Claude sign-in is not configured on this deployment.
            </p>
          </Show>
          <Show when={props.status?.enabled}>
            <div class="flex flex-col gap-4">
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
                      onInput={(event) =>
                        props.onCode(event.currentTarget.value)
                      }
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
                    Disconnecting removes Macro’s access. It does not revoke
                    consent at Claude or stop a cloud turn already running.
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
              <Show when={!props.status?.connected && !props.login}>
                <div>
                  <Button
                    type="button"
                    variant="cta"
                    size="sm"
                    disabled={props.busy}
                    onClick={props.onBegin}
                  >
                    {props.busy ? 'Connecting…' : 'Connect Claude'}
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
        </RuntimeSettingsDialog>
      </Show>
    </>
  );
}
