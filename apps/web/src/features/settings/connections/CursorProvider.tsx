import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
  useSetCursorDefaultModel,
} from '@queries/auth/cursor-api-key';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { DisconnectAction } from '../integration-ui';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import { CapabilityRow } from './capability-row';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import { closeConnectionsProvider } from './view-state';

const CURSOR_KEY_PREFIX = 'crsr_';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

export function CursorProvider() {
  const [cursorApiKey, setCursorApiKey] = createSignal('');
  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const cursorStatus = useCursorApiKeyStatusQuery();
  const saveCursorApiKey = useSaveCursorApiKey();
  const disconnectCursor = useDisconnectCursorApiKey();
  const cursorRegistered = () => cursorStatus.data?.registered ?? false;
  const cursorModels = useCursorModelsQuery(cursorRegistered);
  const setCursorDefaultModel = useSetCursorDefaultModel();
  const models = () => cursorModels.data?.models ?? [];
  const selectedModelId = () => {
    const id = cursorStatus.data?.defaultModelId;
    const list = models();
    if (id && list.some((model) => model.id === id)) return id;
    return list[0]?.id ?? '';
  };

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
      title="Cursor"
      description="Use your Cursor account to run agent sessions in Macro."
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <CapabilityRow
            title="Cursor"
            outcome="Use your Cursor account to run agent sessions in Macro. Disconnect from Macro deletes Macro's copy of the key. It does not revoke the key in Cursor."
            status={
              !cursorStatus.isPlaceholderData && cursorRegistered()
                ? 'connected'
                : undefined
            }
          >
            <Show
              when={!cursorStatus.isPlaceholderData}
              fallback={<span class="text-xs text-ink-muted">Loading…</span>}
            >
              <Show when={cursorRegistered()}>
                <DisconnectAction
                  disabled={disconnectCursor.isPending}
                  onClick={() =>
                    setDisconnect({
                      title: 'Disconnect from Macro',
                      body: "Disconnect Cursor? This deletes Macro's copy of the key. It does not revoke the key in Cursor.",
                      onConfirm: () => void handleDisconnectCursor(),
                    })
                  }
                />
              </Show>
            </Show>
          </CapabilityRow>
          <Show when={!cursorStatus.isPlaceholderData}>
            <Show
              when={cursorRegistered()}
              fallback={
                <div class="flex flex-col gap-1.5 px-6 py-3.5">
                  <label
                    for="cursor-connections-api-key"
                    class="text-xs text-ink"
                  >
                    API key
                  </label>
                  <div class="flex items-center gap-2 mobile:flex-col mobile:items-stretch">
                    <input
                      id="cursor-connections-api-key"
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
                      onClick={() => void handleSaveCursorApiKey()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              }
            >
              <SettingsRow
                label={<label for="cursor-default-model">Default model</label>}
                description="The model new @cursor sessions start on. You can still switch it per session."
                stackOnNarrow
                align="start"
              >
                <select
                  id="cursor-default-model"
                  class="settings-input w-full min-w-0 bg-inset disabled:opacity-100 @[460px]:w-56"
                  value={selectedModelId()}
                  disabled={
                    setCursorDefaultModel.isPending || models().length === 0
                  }
                  aria-busy={models().length === 0}
                  onChange={(event) =>
                    void handleCursorModelChange(event.currentTarget.value)
                  }
                >
                  <Show when={models().length === 0}>
                    <option value="">Loading models…</option>
                  </Show>
                  <For each={models()}>
                    {(model) => (
                      <option value={model.id}>{model.displayName}</option>
                    )}
                  </For>
                </select>
              </SettingsRow>
            </Show>
          </Show>
        </SettingsCard>
      </SettingsSection>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </SettingsPage>
  );
}
