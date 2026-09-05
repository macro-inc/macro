import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
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
import {
  useDeleteHarnessMutation,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { useSearchParams } from '@solidjs/router';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { HarnessPairingDialog } from './HarnessPairingDialog';
import { ConnectAction, StatusDot } from './integration-ui';
import { SettingsCard, SettingsPage } from './primitives';

const BYOA_DOCS_URL = 'https://docs.macro.com/AI/bring-your-own';
const CURSOR_KEY_PREFIX = 'crsr_';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

function lastConnectedText(harness: RegisteredHarness): string {
  return harness.last_connected_at
    ? `Last connected ${new Date(harness.last_connected_at).toLocaleString()}`
    : 'Never connected';
}

/** Settings UI for choosing and configuring the available agent harnesses. */
export function Harness() {
  const [cursorApiKey, setCursorApiKey] = createSignal('');
  const cursorStatus = useCursorApiKeyStatusQuery();
  const saveCursorApiKey = useSaveCursorApiKey();
  const disconnectCursor = useDisconnectCursorApiKey();
  const cursorRegistered = () => cursorStatus.data?.registered ?? false;
  const harnessesQuery = useHarnessesQuery();
  const deleteHarnessMutation = useDeleteHarnessMutation();
  const [pairingDialog, setPairingDialog] = createSignal<{
    initialCode?: string;
  }>();
  const [removingHarness, setRemovingHarness] =
    createSignal<RegisteredHarness>();
  const [searchParams, setSearchParams] = useSearchParams();

  onMount(() => {
    const pair = searchParams.pair;
    if (typeof pair === 'string' && pair.length > 0) {
      setPairingDialog({ initialCode: pair });
      setSearchParams({ pair: undefined }, { replace: true });
    }
  });

  const removeHarness = async () => {
    const current = removingHarness();
    if (!current) return;

    try {
      await deleteHarnessMutation.mutateAsync({ harnessId: current.id });
      setRemovingHarness(undefined);
      toast.success('Harness removed');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to remove harness'));
    }
  };

  // Only worth fetching once there is a key to ask Cursor through.
  const cursorModels = useCursorModelsQuery(cursorRegistered);
  const setCursorDefaultModel = useSetCursorDefaultModel();
  const cursorModelOptions = () =>
    (cursorModels.data?.models ?? []).map((model) => ({
      id: model.id,
      label: model.displayName,
      group: model.group,
    }));
  const selectedCursorModelId = () =>
    cursorStatus.data?.defaultModelId ?? cursorModelOptions()[0]?.id ?? null;

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
                  <Show
                    when={isLargeModelCatalog(cursorModelOptions())}
                    fallback={
                      <select
                        id="cursor-default-model"
                        class="settings-input w-56"
                        value={cursorStatus.data?.defaultModelId ?? ''}
                        disabled={setCursorDefaultModel.isPending}
                        onChange={(event) =>
                          void handleCursorModelChange(
                            event.currentTarget.value
                          )
                        }
                      >
                        <For each={cursorModels.data?.models ?? []}>
                          {(model) => (
                            <option value={model.id}>
                              {model.displayName}
                            </option>
                          )}
                        </For>
                      </select>
                    }
                  >
                    <ModelCatalogPicker
                      value={selectedCursorModelId()}
                      options={cursorModelOptions()}
                      onSelect={(id) => void handleCursorModelChange(id)}
                      disabled={setCursorDefaultModel.isPending}
                      ariaLabel="Default model"
                      triggerClass="w-72 max-w-full justify-between"
                    />
                  </Show>
                  <p class="text-xs text-ink-extra-muted">
                    The model new `@cursor` sessions start on. Recommended
                    models stay up top; everything else is behind More models.
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
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  depth={3}
                  onClick={() => setPairingDialog({})}
                >
                  Enter pairing code
                </Button>
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
                each={harnessesQuery.data ?? []}
                fallback={
                  <div class="flex flex-col items-center py-6 text-center">
                    <p class="text-sm text-ink">No agents connected</p>
                    <p class="mt-1 text-xs text-ink-extra-muted">
                      Agents connected through macrod will appear here.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      depth={3}
                      class="mt-3"
                      onClick={() => setPairingDialog({})}
                    >
                      Enter pairing code
                    </Button>
                  </div>
                }
              >
                {(harness) => (
                  <div class="flex items-center justify-between gap-4 px-4 py-3">
                    <div class="min-w-0">
                      <div class="flex min-w-0 items-center gap-2">
                        <p class="truncate text-sm text-ink">{harness.name}</p>
                        <span class="shrink-0 rounded-full border border-edge-muted px-2 py-0.5 text-xxs font-medium uppercase text-ink-extra-muted">
                          {harness.owner.type === 'team' ? 'Team' : 'Private'}
                        </span>
                        <StatusDot
                          state={
                            harness.connected ? 'connected' : 'disconnected'
                          }
                          label={
                            harness.connected ? 'Connected' : 'Disconnected'
                          }
                        />
                      </div>
                      <p class="mt-0.5 truncate text-xs text-ink-extra-muted">
                        {lastConnectedText(harness)}
                      </p>
                    </div>
                    <ConnectAction
                      label="Remove"
                      variant="danger"
                      onClick={() => setRemovingHarness(harness)}
                    />
                  </div>
                )}
              </For>
              <Show when={harnessesQuery.isError}>
                <p class="px-4 py-3 text-xs text-negative">
                  Could not load your harnesses. Try refreshing this page.
                </p>
              </Show>
            </div>
          </div>
        </section>
      </SettingsCard>

      <Show when={pairingDialog()} keyed>
        {(dialog) => (
          <HarnessPairingDialog
            initialCode={dialog.initialCode}
            onClose={() => setPairingDialog(undefined)}
          />
        )}
      </Show>
      <Show when={removingHarness()} keyed>
        {(harness) => (
          <HarnessRemoveDialog
            harnessName={harness.name}
            pending={deleteHarnessMutation.isPending}
            onClose={() => setRemovingHarness(undefined)}
            onConfirm={() => void removeHarness()}
          />
        )}
      </Show>
    </SettingsPage>
  );
}

function HarnessRemoveDialog(props: {
  harnessName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Remove {props.harnessName}?
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-5">
          <Dialog.Description class="text-sm leading-5 text-ink-muted">
            Agents using this harness will stop running until it's reconnected.
            macrod on that machine will need to pair again.
          </Dialog.Description>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.pending ? 'Removing…' : 'Remove harness'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

function HarnessIcon(props: { children: JSX.Element }) {
  return (
    <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/4 text-ink-muted [&_svg]:size-5">
      {props.children}
    </div>
  );
}
