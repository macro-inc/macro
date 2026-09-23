import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { useAgentModelsQuery } from '@queries/agents/models';
import {
  useCursorApiKeyStatusQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
  useSetCursorDefaultModel,
} from '@queries/auth/cursor-api-key';
import { Button } from '@ui';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { RuntimeRow } from './components/runtime-row';
import { RuntimeSettingsDialog } from './components/runtime-settings-dialog';

const CURSOR_KEY_PREFIX = 'crsr_';
function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/** App-facing wiring for Cursor's existing account and model queries. */
export function CursorRuntime() {
  return (
    <Suspense
      fallback={<p class="px-6 py-5 text-sm text-ink-muted">Loading Cursor…</p>}
    >
      <CursorRuntimeContent />
    </Suspense>
  );
}

function CursorRuntimeContent() {
  let trigger: HTMLButtonElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [cursorApiKey, setCursorApiKey] = createSignal('');
  const cursorStatus = useCursorApiKeyStatusQuery();
  const saveCursorApiKey = useSaveCursorApiKey();
  const disconnectCursor = useDisconnectCursorApiKey();
  const cursorRegistered = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const cursorModels = useAgentModelsQuery(
    () => ({ harness: 'cursor' }),
    cursorRegistered
  );
  const cursorModelData = () =>
    cursorModels.isSuccess ? cursorModels.data : undefined;
  const cursorModelOptions = () => {
    const data = cursorModelData();
    if (data?.status !== 'available') return [];
    const saved = cursorStatus.isSuccess
      ? cursorStatus.data.defaultModelId
      : null;
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
      <RuntimeRow
        triggerRef={(element) => {
          trigger = element;
        }}
        name="Cursor"
        system
        description="Coding agents, powered by your Cursor account."
        icon={<CursorIcon />}
        status={
          cursorStatus.isPlaceholderData || !cursorStatus.isSuccess
            ? cursorStatus.isError
              ? 'Unavailable'
              : 'Loading…'
            : cursorRegistered()
              ? 'Connected'
              : 'Not connected'
        }
        connected={cursorRegistered()}
        actionLabel={cursorRegistered() ? 'Configure' : 'Connect'}
        onConfigure={() => setOpen(true)}
      />
      <Show when={open()}>
        <RuntimeSettingsDialog
          returnFocus={() => trigger}
          title="Cursor"
          description="Connect your Cursor account and choose the model new sessions start with."
          busy={
            saveCursorApiKey.isPending ||
            disconnectCursor.isPending ||
            setCursorDefaultModel.isPending
          }
          onClose={() => setOpen(false)}
        >
          <Show
            when={cursorStatus.isSuccess && !cursorStatus.isPlaceholderData}
            fallback={
              <p class="mt-4 text-xs text-ink-muted">
                {cursorStatus.isError
                  ? 'Could not load your Cursor connection. Try refreshing this page.'
                  : 'Loading connection…'}
              </p>
            }
          >
            <Show
              when={cursorRegistered()}
              fallback={
                <div class="flex flex-col gap-1.5">
                  <label for="cursor-harness-api-key" class="text-xs text-ink">
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
                        if (
                          event.key === 'Enter' &&
                          !saveCursorApiKey.isPending
                        ) {
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
                      {saveCursorApiKey.isPending
                        ? 'Connecting…'
                        : 'Connect Cursor'}
                    </Button>
                  </div>
                  <p class="text-xs text-ink-extra-muted">
                    Create an API key in Cursor and paste it here. Your key is
                    stored encrypted.
                  </p>
                </div>
              }
            >
              <div class="flex flex-col gap-1.5">
                <label for="cursor-default-model" class="text-xs text-ink">
                  Default model
                </label>
                <Show
                  when={!cursorModels.isPending}
                  fallback={
                    <select
                      id="cursor-default-model"
                      class="settings-input w-full"
                      disabled
                    >
                      <option>Loading models…</option>
                    </select>
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
                        when={isLargeModelCatalog(cursorCatalogOptions())}
                        fallback={
                          <select
                            id="cursor-default-model"
                            class="settings-input w-full"
                            value={
                              (cursorStatus.isSuccess
                                ? cursorStatus.data.defaultModelId
                                : null) ??
                              cursorModelData()?.currentModel ??
                              cursorModelOptions()[0]?.id ??
                              ''
                            }
                            disabled={setCursorDefaultModel.isPending}
                            onChange={(event) =>
                              void handleCursorModelChange(
                                event.currentTarget.value
                              )
                            }
                          >
                            <For each={cursorModelOptions()}>
                              {(model) => (
                                <option value={model.id}>{model.name}</option>
                              )}
                            </For>
                          </select>
                        }
                      >
                        <ModelCatalogPicker
                          value={selectedCursorModelId()}
                          options={cursorCatalogOptions()}
                          onSelect={(id) => void handleCursorModelChange(id)}
                          disabled={setCursorDefaultModel.isPending}
                          ariaLabel="Default model"
                          triggerClass="w-full justify-between"
                        />
                      </Show>
                    </Show>
                  </Show>
                </Show>
                <p class="text-xs text-ink-extra-muted">
                  Used for new Cursor sessions. You can choose a different model
                  for each agent.
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
        </RuntimeSettingsDialog>
      </Show>
    </>
  );
}
