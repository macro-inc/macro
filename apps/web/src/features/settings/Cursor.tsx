import { toast } from '@core/component/Toast/Toast';
import {
  useCursorApiKeyStatusQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
} from '@queries/auth/cursor-api-key';
import { Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { ConnectAction, StatusDot } from './integration-ui';
import { IntegrationRow, SettingsCard, SettingsRow } from './primitives';

/** Cursor's key prefix; the server checks this too, and is the authority. */
const CURSOR_KEY_PREFIX = 'crsr_';

/**
 * Cursor as a Connected-accounts card.
 *
 * Unlike GitHub and Gmail there is no OAuth flow to start — Cursor issues API
 * keys, so the user pastes one. That difference drives the whole shape of this
 * card: an input rather than a Connect button, and no way to read the key back
 * afterwards.
 */
export function CursorCard() {
  const status = useCursorApiKeyStatusQuery();
  const saveKey = useSaveCursorApiKey();
  const disconnect = useDisconnectCursorApiKey();

  const [apiKey, setApiKey] = createSignal('');
  const registered = () => status.data?.registered ?? false;
  // False when the deployment has no KMS key configured. Saving would fail, so
  // the field is disabled with an explanation rather than left to 503.
  const available = () => status.data?.available ?? false;

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
    } catch {
      toast.failure('Failed to save your Cursor API key');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success('Cursor disconnected');
    } catch {
      toast.failure('Failed to disconnect Cursor');
    }
  };

  return (
    <SettingsCard>
      <IntegrationRow
        icon={<span class="text-sm font-medium text-ink-muted">Cs</span>}
        title="Cursor"
        description="Run @cursor sessions on your own Cursor account."
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
            <Match when={!available()}>
              This deployment is not set up to accept Cursor API keys.
            </Match>
            <Match when={registered()}>
              Stored encrypted. Removing it here does not revoke the key at
              Cursor — do that in your Cursor account.
            </Match>
          </Switch>
        }
      >
        <Show
          when={!status.isLoading}
          fallback={<span class="text-xs text-ink-muted">Loading…</span>}
        >
          <Switch
            fallback={
              <div class="flex items-center gap-2">
                <input
                  // `password` so the browser masks it and the value stays out
                  // of screen shares while it is being pasted.
                  type="password"
                  autocomplete="off"
                  class="settings-input ph-no-capture w-56"
                  placeholder={`${CURSOR_KEY_PREFIX}…`}
                  value={apiKey()}
                  disabled={!available()}
                  onInput={(event) => setApiKey(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleSave();
                  }}
                />
                <Button
                  variant="base"
                  size="sm"
                  depth={3}
                  disabled={
                    !available() || apiKey().length === 0 || saveKey.isPending
                  }
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
    </SettingsCard>
  );
}
