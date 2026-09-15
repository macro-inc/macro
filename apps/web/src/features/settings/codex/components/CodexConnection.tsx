import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { CodexConnectionDisplay, CodexLoginDisplay } from '../core/types';

export function CodexConnection(props: {
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
  onSave: (config: { environmentId: string | null; branch: string }) => void;
}) {
  const [environment, setEnvironment] = createSignal<string>();
  const [branch, setBranch] = createSignal<string>();
  const selectedEnvironment = () =>
    environment() ?? props.connection?.environmentId ?? '';
  const selectedBranch = () => branch() ?? props.connection?.branch ?? '';
  const connected = () => props.connection?.connected === true;
  const loginPending = () => props.login?.status === 'pending';
  return (
    <section class="flex gap-4 px-6 py-5" aria-label="Codex connection">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-medium text-ink">Codex</h2>
          <Show when={connected()}>
            <span class="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
              Connected
            </span>
          </Show>
        </div>
        <p class="mt-1 text-sm text-ink-muted">
          Connect ChatGPT to run Codex cloud sessions in Macro.
        </p>
        <Show when={props.error}>
          <p role="alert" class="mt-3 text-sm text-negative">
            {props.error}
          </p>
        </Show>
        <Show
          when={!props.loading}
          fallback={
            <p class="mt-3 text-sm text-ink-muted">Loading Codex connection…</p>
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
                        variant="outline"
                        size="sm"
                        disabled={props.pending}
                        onClick={props.onConnect}
                      >
                        Connect with ChatGPT
                      </Button>
                    </>
                  }
                >
                  <p class="text-sm text-ink">
                    Open ChatGPT and enter this code to connect your account.
                  </p>
                  <code class="ph-no-capture select-all rounded-md bg-input px-3 py-2 text-lg font-medium tracking-widest">
                    {props.login?.userCode}
                  </code>
                  <a
                    class="text-sm text-accent underline"
                    href={props.login?.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Continue to ChatGPT
                  </a>
                  <p role="status" class="text-xs text-ink-muted">
                    Waiting for sign-in… Code expires{' '}
                    {props.login
                      ? new Date(props.login.expiresAt).toLocaleTimeString()
                      : ''}
                    .
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={props.pending}
                    onClick={props.onCancel}
                  >
                    Cancel sign-in
                  </Button>
                </Show>
              </div>
            }
          >
            <Show when={props.connection?.email ?? props.connection?.accountId}>
              <p class="mt-3 text-sm text-ink-muted">
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
                    const id = event.currentTarget.value;
                    setEnvironment(id);
                    setBranch(
                      props.environments.find((item) => item.id === id)
                        ?.repositories[0]?.defaultBranch ?? ''
                    );
                  }}
                >
                  <option value="" selected={!selectedEnvironment()}>
                    Automatic (from your prompt)
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
              <p class="text-xs text-ink-muted">
                Automatic chooses a repository and its default branch from your
                prompt. If Codex cannot confidently choose, select an
                environment here and try again.
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
                <p class="text-xs text-ink-muted">
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
              <Show when={selectedEnvironment()}>
                <label
                  class="flex flex-col gap-1.5 text-xs text-ink"
                  for="codex-branch"
                >
                  Branch
                  <input
                    id="codex-branch"
                    class="settings-input w-full max-w-sm"
                    value={selectedBranch()}
                    onInput={(event) => setBranch(event.currentTarget.value)}
                    disabled={props.pending}
                    placeholder="Branch or git ref"
                  />
                </label>
                <p class="text-xs text-ink-muted">
                  New @codex sessions use this environment and branch.
                </p>
              </Show>
              <div class="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    props.pending ||
                    (!!selectedEnvironment() && !selectedBranch().trim())
                  }
                  onClick={() =>
                    props.onSave({
                      environmentId: selectedEnvironment() || null,
                      branch: selectedEnvironment()
                        ? selectedBranch().trim()
                        : props.connection?.branch.trim() || 'main',
                    })
                  }
                >
                  Save Codex settings
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={props.pending}
                  onClick={() => {
                    setEnvironment(undefined);
                    setBranch(undefined);
                    props.onDisconnect();
                  }}
                >
                  Disconnect ChatGPT
                </Button>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  );
}
