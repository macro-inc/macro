import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
  useSetCursorDefaultModel,
} from '@queries/auth/cursor-api-key';
import type { CursorModelOption } from '@service-auth/generated/schemas';
import { Button, Select } from '@ui';
import { createSignal, Show } from 'solid-js';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import { ConnectionRowActions } from './connection-more';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import { providerIcon } from './provider-meta';
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
  const modelsLoading = () =>
    cursorRegistered() &&
    !cursorModels.isError &&
    (cursorModels.isPending || cursorModels.isPlaceholderData);
  const selectedModelId = () => {
    const id = cursorStatus.data?.defaultModelId;
    const list = models();
    if (id && list.some((model) => model.id === id)) return id;
    return '';
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
      icon={providerIcon('cursor')}
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <IntegrationRow
            title="Cursor"
            description="Use your Cursor account to run agent sessions in Macro."
            facts="Disconnect from Macro deletes Macro's copy of the key. It does not revoke the key in Cursor."
          >
            <Show
              when={!cursorStatus.isPlaceholderData}
              fallback={
                <span role="status" aria-label="Loading">
                  <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
                </span>
              }
            >
              <Show when={cursorRegistered()}>
                <ConnectionRowActions
                  items={[
                    {
                      label: 'Disconnect',
                      danger: true,
                      icon: 'disconnect',
                      disabled: disconnectCursor.isPending,
                      onSelect: () =>
                        setDisconnect({
                          title: 'Disconnect from Macro',
                          body: "Disconnect Cursor? This deletes Macro's copy of the key. It does not revoke the key in Cursor.",
                          onConfirm: () => void handleDisconnectCursor(),
                        }),
                    },
                  ]}
                />
              </Show>
            </Show>
          </IntegrationRow>
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
                <Show
                  when={cursorModels.isError}
                  fallback={
                    <Show
                      when={models().length > 0 || modelsLoading()}
                      fallback={
                        <span class="text-sm text-ink-muted">
                          No models available.
                        </span>
                      }
                    >
                      <Select<CursorModelOption>
                        class="w-full"
                        options={models()}
                        optionValue="id"
                        optionTextValue="displayName"
                        value={
                          models().find(
                            (model) => model.id === selectedModelId()
                          ) ?? undefined
                        }
                        onChange={(model) => {
                          if (model) void handleCursorModelChange(model.id);
                        }}
                        disabled={
                          setCursorDefaultModel.isPending || modelsLoading()
                        }
                      >
                        <Select.Trigger
                          id="cursor-default-model"
                          class="settings-input w-full min-w-0 bg-inset disabled:opacity-100 @[460px]:w-56"
                          aria-label="Default model"
                          aria-busy={modelsLoading()}
                        >
                          <Select.Value<CursorModelOption>>
                            {(state) =>
                              state.selectedOption()?.displayName ?? ''
                            }
                          </Select.Value>
                          <Show
                            when={!modelsLoading()}
                            fallback={
                              <span role="status" aria-label="Loading models">
                                <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
                              </span>
                            }
                          >
                            <Select.Icon />
                          </Show>
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Listbox />
                        </Select.Content>
                      </Select>
                    </Show>
                  }
                >
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-ink-muted">
                      Couldn't load models.
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      depth={3}
                      onClick={() => void cursorModels.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                </Show>
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
