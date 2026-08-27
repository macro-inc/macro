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
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { ConnectAction, StatusDot } from './integration-ui';
import { IntegrationRow, SettingsCard, SettingsRow } from './primitives';

/** Cursor's key prefix; the server checks this too, and is the authority. */
const CURSOR_KEY_PREFIX = 'crsr_';

/**
 * The server's own words for a failure, or `fallback` when it sent none.
 *
 * Worth the deviation from the fixed-message pattern the other cards use: the
 * server distinguishes a key it rejected on shape from a caller it will not
 * accept keys from at all, and only it knows which happened.
 */
function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/**
 * Cursor as a Connected-accounts card.
 */
export function CursorCard() {
  const status = useCursorApiKeyStatusQuery();
  const saveKey = useSaveCursorApiKey();
  const disconnect = useDisconnectCursorApiKey();

  const [apiKey, setApiKey] = createSignal('');
  const registered = () => status.data?.registered ?? false;

  // Only worth fetching once there is a key to ask Cursor through.
  const models = useCursorModelsQuery(registered);
  const setDefaultModel = useSetCursorDefaultModel();

  const handleModelChange = async (modelId: string) => {
    try {
      await setDefaultModel.mutateAsync(modelId);
      toast.success('Default model updated');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to set your default model'));
    }
  };

  const handleSave = async () => {
    const key = apiKey().trim();
    if (!key.startsWith(CURSOR_KEY_PREFIX)) {
      toast.failure(`Cursor API keys start with ${CURSOR_KEY_PREFIX}`);
      return;
    }
    try {
      await saveKey.mutateAsync(key);
      // Cleared on success so the key does not sit in the DOM, and because
      // there is nothing to edit afterwards — replacing means pasting again.
      setApiKey('');
      toast.success('Cursor connected');
    } catch (error) {
      toast.failure(
        failureMessage(error, 'Failed to save your Cursor API key')
      );
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success('Cursor disconnected');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to disconnect Cursor'));
    }
  };

  return (
    <SettingsCard>
      <IntegrationRow
        icon={<span class="text-sm font-medium text-ink-muted">Cs</span>}
        title="Cursor"
        description="Run @cursor coding sessions on your Cursor account."
      />

      <SettingsRow
        label={
          <span class="flex items-center gap-2">
            <span>API key</span>
            <Show when={registered()}>
              <StatusDot state="connected" label="Connected" />
            </Show>
          </span>
        }
        description={
          <Switch fallback="Paste a key from Cursor's dashboard. Macro stores it encrypted and never shows it again.">
            <Match when={registered()}>Stored encrypted.</Match>
          </Switch>
        }
      >
        <Show
          // The placeholder reads as "no key", which for this card would flash
          // the paste-a-key input at someone who has one already.
          when={!status.isPlaceholderData}
          fallback={<span class="text-xs text-ink-muted">Loading…</span>}
        >
          <Switch
            fallback={
              <div class="flex items-center gap-2">
                <input
                  type="password"
                  autocomplete="off"
                  class="settings-input ph-no-capture w-56"
                  placeholder={`${CURSOR_KEY_PREFIX}…`}
                  value={apiKey()}
                  onInput={(event) => setApiKey(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleSave();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  depth={3}
                  disabled={apiKey().length === 0 || saveKey.isPending}
                  onClick={handleSave}
                >
                  Save
                </Button>
              </div>
            }
          >
            <Match when={registered()}>
              <ConnectAction
                label="Disconnect"
                variant="danger"
                onClick={handleDisconnect}
                disabled={disconnect.isPending}
              />
            </Match>
          </Switch>
        </Show>
      </SettingsRow>

      <Show when={registered()}>
        <SettingsRow
          label="Default model"
          description="The model new @cursor sessions start on. You can still switch it per session."
        >
          <select
            class="settings-input w-56"
            value={status.data?.defaultModelId ?? ''}
            disabled={setDefaultModel.isPending}
            onChange={(event) =>
              void handleModelChange(event.currentTarget.value)
            }
          >
            <For each={models.data?.models ?? []}>
              {(model) => <option value={model.id}>{model.displayName}</option>}
            </For>
          </select>
        </SettingsRow>
      </Show>
    </SettingsCard>
  );
}
