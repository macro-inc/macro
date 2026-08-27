import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import HardDrivesIcon from '@phosphor/hard-drives.svg';
import TerminalWindowIcon from '@phosphor/terminal-window.svg';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
  useSetCursorDefaultModel,
} from '@queries/auth/cursor-api-key';
import { Button } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { SettingsCard, SettingsPage } from './primitives';

const BYOA_DOCS_URL = 'https://docs.macro.com/AI/bring-your-own';
const CURSOR_KEY_PREFIX = 'crsr_';

type ConnectedAgent = {
  id: string;
  name: string;
  description: string;
};

// Connected-agent data will replace this empty list when BYOA is wired up.
const connectedAgents: ConnectedAgent[] = [];

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/** Settings UI for choosing and configuring the available agent harnesses. */
export function Harness() {
  const [cursorApiKey, setCursorApiKey] = createSignal('');
  const cursorStatus = useCursorApiKeyStatusQuery();
  const saveCursorApiKey = useSaveCursorApiKey();
  const disconnectCursor = useDisconnectCursorApiKey();
  const cursorRegistered = () => cursorStatus.data?.registered ?? false;

  // Only worth fetching once there is a key to ask Cursor through.
  const cursorModels = useCursorModelsQuery(cursorRegistered);
  const setCursorDefaultModel = useSetCursorDefaultModel();

  const handleCursorModelChange = async (modelId: string) => {
    try {
      await setCursorDefaultModel.mutateAsync(modelId);
      toast.success('Default model updated');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to set your default model'));
    }
  };

  const handleSaveCursorApiKey = async () => {
    const apiKey = cursorApiKey().trim();
    if (!apiKey.startsWith(CURSOR_KEY_PREFIX)) {
      toast.failure(`Cursor API keys start with ${CURSOR_KEY_PREFIX}`);
      return;
    }

    try {
      await saveCursorApiKey.mutateAsync(apiKey);
      setCursorApiKey('');
      toast.success('Cursor connected');
    } catch (error) {
      toast.failure(
        failureMessage(error, 'Failed to save your Cursor API key')
      );
    }
  };

  const handleDisconnectCursor = async () => {
    try {
      await disconnectCursor.mutateAsync();
      setCursorApiKey('');
      toast.success('Cursor disconnected');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to disconnect Cursor'));
    }
  };

  return (
    <SettingsPage
      title="Harness"
      description="Configure how agents run for your Macro workspace."
    >
      <SettingsCard>
        <section class="flex gap-4 px-6 py-5">
          <HarnessIcon>
            <HardDrivesIcon />
          </HarnessIcon>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-medium text-ink">In-memory</h2>
              <span class="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
                Built in
              </span>
            </div>
            <p class="mt-1 text-sm text-ink-muted">
              Macro's in-memory harness runs agents directly in your workspace.
              It is ready to use and does not require any configuration. This is
              not a coding harness.
            </p>
          </div>
        </section>

        <section class="flex gap-4 px-6 py-5">
          <HarnessIcon>
            <CursorIcon />
          </HarnessIcon>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-medium text-ink">Cursor</h2>
              <Show when={cursorRegistered()}>
                <span class="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
                  Connected
                </span>
              </Show>
            </div>
            <p class="mt-1 text-sm text-ink-muted">
              Use your Cursor account to run agent sessions in Macro.
            </p>

            <Show
              when={!cursorStatus.isPlaceholderData}
              fallback={<p class="mt-4 text-xs text-ink-muted">Loading…</p>}
            >
              <Show
                when={cursorRegistered()}
                fallback={
                  <div class="mt-4 flex flex-col gap-1.5">
                    <label
                      for="cursor-harness-api-key"
                      class="text-xs text-ink"
                    >
                      API key
                    </label>
                    <div class="flex items-center gap-2 mobile:flex-col mobile:items-stretch">
                      <input
                        id="cursor-harness-api-key"
                        type="password"
                        autocomplete="off"
                        spellcheck={false}
                        class="settings-input ph-no-capture min-w-0 flex-1"
                        placeholder={`${CURSOR_KEY_PREFIX}…`}
                        value={cursorApiKey()}
                        onInput={(event) =>
                          setCursorApiKey(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            void handleSaveCursorApiKey();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        depth={3}
                        disabled={
                          cursorApiKey().trim().length === 0 ||
                          saveCursorApiKey.isPending
                        }
                        onClick={handleSaveCursorApiKey}
                      >
                        Save
                      </Button>
                    </div>
                    <p class="text-xs text-ink-extra-muted">
                      Create an API key in Cursor and paste it here. Macro
                      stores it encrypted.
                    </p>
                  </div>
                }
              >
                <div class="mt-4 flex flex-col gap-1.5">
                  <label for="cursor-default-model" class="text-xs text-ink">
                    Default model
                  </label>
                  <select
                    id="cursor-default-model"
                    class="settings-input w-56"
                    value={cursorStatus.data?.defaultModelId ?? ''}
                    disabled={setCursorDefaultModel.isPending}
                    onChange={(event) =>
                      void handleCursorModelChange(event.currentTarget.value)
                    }
                  >
                    <For each={cursorModels.data?.models ?? []}>
                      {(model) => (
                        <option value={model.id}>{model.displayName}</option>
                      )}
                    </For>
                  </select>
                  <p class="text-xs text-ink-extra-muted">
                    The model new @cursor sessions start on. You can still
                    switch it per session.
                  </p>
                </div>

                <div class="mt-4 flex items-center justify-between gap-4 mobile:items-start">
                  <p class="text-xs text-ink-extra-muted">
                    Disconnecting removes Macro's copy of the key but does not
                    revoke it in Cursor.
                  </p>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    depth={3}
                    class="shrink-0"
                    disabled={disconnectCursor.isPending}
                    onClick={handleDisconnectCursor}
                  >
                    Disconnect
                  </Button>
                </div>
              </Show>
            </Show>
          </div>
        </section>

        <section class="flex gap-4 px-6 py-5">
          <HarnessIcon>
            <TerminalWindowIcon />
          </HarnessIcon>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-4">
              <h2 class="text-sm font-medium text-ink">Bring your own agent</h2>
              <a
                href={BYOA_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
              >
                Setup guide
                <ArrowUpRightIcon class="size-3.5 opacity-70" />
              </a>
            </div>
            <p class="mt-1 text-sm text-ink-muted">
              Install macrod on your computer to connect Claude or another
              compatible agent.
            </p>

            <div class="mt-5">
              <div class="text-xs font-medium text-ink-muted">
                Connected agents
              </div>
              <For
                each={connectedAgents}
                fallback={
                  <div class="flex flex-col items-center py-6 text-center">
                    <p class="text-sm text-ink">No agents connected</p>
                    <p class="mt-1 text-xs text-ink-extra-muted">
                      Agents connected through macrod will appear here.
                    </p>
                  </div>
                }
              >
                {(agent) => (
                  <div class="flex items-center justify-between gap-4 px-4 py-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm text-ink">{agent.name}</p>
                      <p class="truncate text-xs text-ink-extra-muted">
                        {agent.description}
                      </p>
                    </div>
                    <span class="text-xs text-success">Connected</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>
      </SettingsCard>
    </SettingsPage>
  );
}

function HarnessIcon(props: { children: JSX.Element }) {
  return (
    <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted [&_svg]:size-5">
      {props.children}
    </div>
  );
}
