import OpenAiIcon from '@core/component/AI/assets/openai.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { RuntimeRow } from '../../runtimes/components/runtime-row';
import { RuntimeSettingsDialog } from '../../runtimes/components/runtime-settings-dialog';
import type { CodexConnectionDisplay, CodexLoginDisplay } from '../core/types';

export function CodexConnection(props: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  connection: CodexConnectionDisplay | undefined;
  login: CodexLoginDisplay | undefined;
  environments: {
    id: string;
    label?: string | null;
    repositories: {
      fullName: string;
      cloneUrl: string;
      defaultBranch: string;
    }[];
  }[];
  environmentsLoading: boolean;
  environmentsError: boolean;
  loading: boolean;
  pending: boolean;
  error: string | undefined;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onRetryEnvironments: () => void;
  onSave: (config: { environmentId: string }) => void;
}) {
  let trigger: HTMLButtonElement | undefined;
  const connected = () => props.connection?.connected === true;
  const needsSetup = () => connected() && !props.connection?.environmentId;
  const ready = () => connected() && !needsSetup();
  const [environment, setEnvironment] = createSignal<string>();
  const selectedEnvironment = () =>
    environment() ?? props.connection?.environmentId ?? '';
  const hasChanges = () =>
    selectedEnvironment() !== (props.connection?.environmentId ?? '');
  const loginPending = () => props.login?.status === 'pending';
  return (
    <>
      <RuntimeRow
        triggerRef={(element) => {
          trigger = element;
        }}
        name="Codex"
        system
        description="Cloud coding sessions with your ChatGPT account."
        icon={<OpenAiIcon />}
        connected={ready()}
        status={
          props.loading
            ? 'Loading…'
            : needsSetup()
              ? 'Setup required'
              : connected()
                ? 'Connected'
                : loginPending()
                  ? 'Sign-in pending'
                  : 'Not connected'
        }
        actionLabel={
          connected() ? 'Configure' : props.login ? 'Continue' : 'Connect'
        }
        onConfigure={props.onOpen}
      />
      <Show when={props.open}>
        <RuntimeSettingsDialog
          returnFocus={() => trigger}
          title="Codex"
          description="Connect your ChatGPT account and choose a cloud environment for coding sessions."
          busy={props.pending}
          onClose={props.onClose}
        >
          <Show when={props.error}>
            <p role="alert" class="mb-4 text-sm text-negative">
              {props.error}
            </p>
          </Show>
          <Show
            when={!props.loading}
            fallback={
              <p class="mt-4 text-xs text-ink-muted">
                Loading Codex connection…
              </p>
            }
          >
            <Show
              when={connected()}
              fallback={
                <div class="mt-4 flex flex-col items-start gap-3">
                  <Show
                    when={loginPending()}
                    fallback={
                      <>
                        <Show when={props.login?.status === 'expired'}>
                          <p role="status" class="text-sm text-ink-muted">
                            This sign-in code expired. Start again to get a new
                            code.
                          </p>
                        </Show>
                        <Show when={props.login?.status === 'failed'}>
                          <p role="alert" class="text-sm text-negative">
                            ChatGPT sign-in failed. Please try again.
                          </p>
                        </Show>
                        <Button
                          type="button"
                          variant="cta"
                          size="sm"
                          disabled={props.pending}
                          onClick={props.onConnect}
                        >
                          Connect with ChatGPT
                        </Button>
                        <p class="text-xs text-ink-extra-muted">
                          You'll finish sign-in on ChatGPT.
                        </p>
                      </>
                    }
                  >
                    <p class="text-sm text-ink">
                      Open ChatGPT and enter this code to connect your account.
                    </p>
                    <code class="ph-no-capture select-all rounded-md border border-edge-muted bg-input px-4 py-2.5 text-lg font-medium tracking-widest text-ink">
                      {props.login?.userCode}
                    </code>
                    <a
                      class="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
                      href={props.login?.verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Continue to ChatGPT
                      <ArrowUpRightIcon class="size-3.5" aria-hidden="true" />
                    </a>
                    <p role="status" class="text-xs text-ink-muted">
                      Waiting for sign-in… Code expires{' '}
                      {props.login
                        ? new Date(props.login.expiresAt).toLocaleTimeString()
                        : ''}
                      .
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      depth={3}
                      disabled={props.pending}
                      onClick={props.onCancel}
                    >
                      Cancel sign-in
                    </Button>
                  </Show>
                </div>
              }
            >
              <Show
                when={props.connection?.email ?? props.connection?.accountId}
              >
                <p class="mt-1 text-xs text-ink-extra-muted break-all">
                  {props.connection?.email ?? props.connection?.accountId}
                </p>
              </Show>
              <div class="mt-4 flex flex-col gap-3">
                <label
                  class="flex flex-col gap-1.5 text-xs text-ink"
                  for="codex-environment"
                >
                  Cloud environment
                  <select
                    id="codex-environment"
                    class="settings-input w-full max-w-sm"
                    value={selectedEnvironment()}
                    disabled={props.environmentsLoading || props.pending}
                    onChange={(event) => {
                      setEnvironment(event.currentTarget.value);
                    }}
                  >
                    <option value="" disabled selected={!selectedEnvironment()}>
                      Choose an environment
                    </option>
                    <For each={props.environments}>
                      {(item) => (
                        <option
                          value={item.id}
                          selected={selectedEnvironment() === item.id}
                        >
                          {item.label ?? item.id}
                          {item.repositories.length
                            ? ` — ${item.repositories.map((repo) => repo.fullName).join(', ')}`
                            : ''}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <p class="text-xs text-ink-extra-muted">
                  Choose and save an environment before using @codex. New
                  sessions always start from the main branch.
                </p>
                <Show when={props.environmentsLoading}>
                  <p role="status" class="text-xs text-ink-muted">
                    Loading environments…
                  </p>
                </Show>
                <Show when={props.environmentsError}>
                  <div class="flex items-center gap-2">
                    <p role="alert" class="text-sm text-negative">
                      Could not load environments.
                    </p>
                    <a
                      href="https://chatgpt.com/codex"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-sm text-accent underline"
                    >
                      Open Codex
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={props.onRetryEnvironments}
                    >
                      Retry environments
                    </Button>
                  </div>
                </Show>
                <Show
                  when={
                    !props.environmentsLoading &&
                    !props.environmentsError &&
                    props.environments.length === 0
                  }
                >
                  <p class="text-xs text-ink-extra-muted">
                    Create a cloud environment in Codex, then retry.
                    <a
                      href="https://chatgpt.com/codex"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="ml-1 text-accent underline"
                    >
                      Open Codex
                    </a>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={props.onRetryEnvironments}
                  >
                    Retry environments
                  </Button>
                </Show>
                <Show when={hasChanges()}>
                  <p role="status" class="text-xs text-ink-muted">
                    Unsaved changes. Save before starting a new @codex session.
                  </p>
                </Show>
                <div class="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    depth={3}
                    disabled={
                      props.pending || !hasChanges() || !selectedEnvironment()
                    }
                    onClick={() =>
                      props.onSave({
                        environmentId: selectedEnvironment(),
                      })
                    }
                  >
                    Save Codex settings
                  </Button>
                </div>
              </div>
              <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p class="flex-1 basis-56 text-xs text-ink-extra-muted">
                  Existing cloud sessions keep running after disconnecting.
                </p>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  depth={3}
                  class="shrink-0"
                  aria-label="Disconnect ChatGPT"
                  disabled={props.pending}
                  onClick={() => {
                    setEnvironment(undefined);
                    props.onDisconnect();
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </Show>
          </Show>
        </RuntimeSettingsDialog>
      </Show>
    </>
  );
}
