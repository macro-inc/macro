import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { toast } from '@core/component/Toast/Toast';
import { MACRO_HARNESS_NAME } from '@core/constant/macroAgent';
import { ThrownResultError } from '@core/util/result';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import HardDrivesIcon from '@phosphor/hard-drives.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useAgentModelsQuery } from '@queries/agents/models';
import {
  useCursorApiKeyStatusQuery,
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
import { Button, confirmDialog, Dialog, Panel } from '@ui';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { ClaudeConnection } from '../claude-connection/claude-connection';
import { CodexHarness } from './codex/views/CodexHarness';
import { AgentSettingsDescription } from './components/agent-settings-description';
import { BringYourOwnAgent } from './components/bring-your-own-agent';
import { SettingsSelect } from './components/settings-select';
import { ConnectAction, HarnessIcon, StatusDot } from './integration-ui';
import { SettingsCard, SettingsPage } from './primitives';
import { RuntimePairingPage } from './RuntimePairingPage';

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
export function Harness(
  props: { navigation?: JSX.Element; startPairing?: boolean } = {}
) {
  const [cursorApiKey, setCursorApiKey] = createSignal('');
  const cursorStatus = useCursorApiKeyStatusQuery();
  const saveCursorApiKey = useSaveCursorApiKey();
  const disconnectCursor = useDisconnectCursorApiKey();
  const cursorRegistered = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const harnessesQuery = useHarnessesQuery();
  const deleteHarnessMutation = useDeleteHarnessMutation();
  const [pairingDialog, setPairingDialog] = createSignal<
    | {
        initialCode?: string;
      }
    | undefined
  >(props.startPairing ? {} : undefined);
  const closePairing = () => {
    setPairingDialog(undefined);
  };
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
      toast.success('Runtime removed');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to remove runtime'));
    }
  };

  const cursorModels = useAgentModelsQuery(
    () => ({ harness: 'cursor' }),
    cursorRegistered
  );
  const cursorModelData = () =>
    cursorModels.isSuccess ? cursorModels.data : undefined;
  const cursorModelOptions = () => {
    const data = cursorModelData();
    if (data?.status !== 'available') return [];
    const saved = cursorStatus.data?.defaultModelId;
    if (!saved || data.models.some((model) => model.id === saved)) {
      return data.models;
    }
    return [
      ...data.models,
      {
        id: saved,
        name: `${saved} (saved, unavailable)`,
        description: undefined,
        group: undefined,
      },
    ];
  };
  const setCursorDefaultModel = useSetCursorDefaultModel();
  const cursorCatalogOptions = () =>
    cursorModelOptions().map((model) => ({
      id: model.id,
      label: model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  const selectedCursorModelId = () =>
    (cursorStatus.isSuccess ? cursorStatus.data.defaultModelId : null) ??
    cursorModelData()?.currentModel ??
    cursorModelOptions()[0]?.id ??
    null;

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
    if (disconnectCursor.isPending) return;
    const confirmed = await confirmDialog({
      title: 'Disconnect Cursor?',
      body: "Remove your Cursor connection from Macro? This removes Macro's copy of the API key but does not revoke it in Cursor.",
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!confirmed || disconnectCursor.isPending) return;
    try {
      await disconnectCursor.mutateAsync();
      setCursorApiKey('');
      toast.success('Cursor disconnected');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to disconnect Cursor'));
    }
  };

  return (
    <>
      <Show when={!pairingDialog()}>
        <SettingsPage
          title={props.navigation ? 'Agents' : 'Runtimes'}
          description={<AgentSettingsDescription />}
          actions={
            <Button
              variant="cta"
              size="sm"
              onClick={() => setPairingDialog({})}
            >
              <PlusIcon />
              New runtime
            </Button>
          }
        >
          <BringYourOwnAgent onAddRuntime={() => setPairingDialog({})} />
          {props.navigation}
          <div>
            <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
              Built-in runtimes
            </h2>
            <SettingsCard>
              <section class="flex gap-4 px-6 py-5">
                <HarnessIcon>
                  <HardDrivesIcon />
                </HarnessIcon>
                <div class="min-w-0 flex-1">
                  <div class="flex min-h-5 items-start justify-between gap-3">
                    <h2 class="min-w-0 text-sm/5 font-medium text-ink">
                      {MACRO_HARNESS_NAME}
                    </h2>
                    <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
                      Built in
                    </span>
                  </div>
                  <p class="mt-1 text-sm text-ink-muted">
                    Macro in house fast and powerful agent. Uses official Macro
                    tools and MCPs to get the job done.
                  </p>
                </div>
              </section>

              <ClaudeConnection />

              <section class="flex gap-4 px-6 py-5">
                <HarnessIcon>
                  <CursorIcon />
                </HarnessIcon>
                <div class="min-w-0 flex-1">
                  <div class="flex min-h-5 items-start justify-between gap-3">
                    <h2 class="min-w-0 text-sm/5 font-medium text-ink">
                      Cursor
                    </h2>
                    <Show when={cursorRegistered()}>
                      <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
                        Connected
                      </span>
                    </Show>
                  </div>
                  <p class="mt-1 text-sm text-ink-muted">
                    Bring your own Cursor subscription to Macro. Manage Cursor
                    Cloud sessions directly in the app.
                  </p>

                  <Show
                    when={
                      cursorStatus.isSuccess && !cursorStatus.isPlaceholderData
                    }
                    fallback={
                      <p class="mt-4 text-xs text-ink-muted">
                        {cursorStatus.isError
                          ? 'Could not load your Cursor connection. Try refreshing this page.'
                          : 'Loading…'}
                      </p>
                    }
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
                      <div class="mt-4 flex flex-col gap-3">
                        <div class="flex w-full max-w-60 flex-col gap-1.5">
                          <span class="text-xs font-medium text-ink">
                            Default model
                          </span>
                          <Show
                            when={!cursorModels.isPending}
                            fallback={
                              <SettingsSelect
                                label="Default model"
                                options={[]}
                                placeholder="Loading models…"
                                onChange={(id) =>
                                  void handleCursorModelChange(id)
                                }
                                disabled
                              />
                            }
                          >
                            <Show
                              when={!cursorModels.isError}
                              fallback={
                                <div class="flex items-center gap-2">
                                  <p class="text-xs text-negative">
                                    Could not load Cursor models.
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void cursorModels.refetch()}
                                  >
                                    Retry
                                  </Button>
                                </div>
                              }
                            >
                              <Show
                                when={cursorModelData()?.status === 'available'}
                                fallback={
                                  <p class="text-xs text-ink-muted">
                                    Cursor does not support model selection.
                                  </p>
                                }
                              >
                                <Show
                                  when={isLargeModelCatalog(
                                    cursorCatalogOptions()
                                  )}
                                  fallback={
                                    <SettingsSelect
                                      label="Default model"
                                      options={cursorModelOptions()}
                                      value={selectedCursorModelId()}
                                      disabled={setCursorDefaultModel.isPending}
                                      onChange={(id) =>
                                        void handleCursorModelChange(id)
                                      }
                                    />
                                  }
                                >
                                  <ModelCatalogPicker
                                    value={selectedCursorModelId()}
                                    options={cursorCatalogOptions()}
                                    onSelect={(id) =>
                                      void handleCursorModelChange(id)
                                    }
                                    disabled={setCursorDefaultModel.isPending}
                                    ariaLabel="Default model"
                                    triggerClass="h-9 w-full justify-between text-base [&>span]:flex-1"
                                    placement="bottom-start"
                                  />
                                </Show>
                              </Show>
                            </Show>
                          </Show>
                        </div>
                        <p class="text-xs text-ink-extra-muted">
                          The model new `@cursor` sessions start on. Recommended
                          models stay up top; everything else is behind More
                          models.
                        </p>
                      </div>

                      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <p class="flex-1 basis-56 text-xs text-ink-extra-muted">
                          Disconnecting removes Macro's copy of the key but does
                          not revoke it in Cursor.
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

              <CodexHarness />
            </SettingsCard>
          </div>

          <Show
            when={!harnessesQuery.isSuccess || harnessesQuery.data.length > 0}
          >
            <div>
              <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
                Paired runtimes
              </h2>
              <SettingsCard>
                <For
                  each={harnessesQuery.isSuccess ? harnessesQuery.data : []}
                  fallback={
                    <div class="flex flex-col items-center py-6 text-center">
                      <p class="text-sm text-ink">
                        {harnessesQuery.isError
                          ? 'Could not load runtimes.'
                          : 'Loading runtimes…'}
                      </p>
                    </div>
                  }
                >
                  {(harness) => (
                    <div class="flex items-center justify-between gap-4 px-4 py-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <p class="min-w-0 flex-1 truncate text-sm text-ink">
                            {harness.name}
                          </p>
                          <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border border-edge-muted px-2 text-xxs/none font-medium uppercase text-ink-extra-muted">
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
                      <div class="shrink-0">
                        <ConnectAction
                          label="Remove"
                          variant="danger"
                          onClick={() => setRemovingHarness(harness)}
                        />
                      </div>
                    </div>
                  )}
                </For>
                <Show when={harnessesQuery.isError}>
                  <p class="px-4 py-3 text-xs text-negative">
                    Could not load your runtimes. Try refreshing this page.
                  </p>
                </Show>
              </SettingsCard>
            </div>
          </Show>
        </SettingsPage>
      </Show>

      <Show when={pairingDialog()} keyed>
        {(dialog) => (
          <RuntimePairingPage
            initialCode={dialog.initialCode}
            onClose={closePairing}
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
    </>
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
            Agents using this runtime will stop running until it's reconnected.
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
            {props.pending ? 'Removing…' : 'Remove runtime'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
