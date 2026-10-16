import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import {
  useCursorApiKeyStatusQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
} from '@queries/auth/cursor-api-key';
import { Button, confirmDialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import cursorApiKeysScreenshot from './assets/cursor-api-keys.png';
import { CursorDefaultModel } from './components/cursor-default-model';
import {
  SetupField,
  SetupLink,
  SetupStep,
} from './components/runtime-setup-steps';
import {
  CURSOR_KEY_FORMAT_ERROR,
  CURSOR_KEY_PLACEHOLDER,
  isCursorApiKey,
} from './core/cursor-api-key';
import { SettingsPage, SettingsSurface } from './primitives';

const CURSOR_API_KEYS_URL = 'https://cursor.com/dashboard/api';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/**
 * Guided Cursor connection: where to create the key, a field to paste it, and
 * the default model once Cursor answers. Also the manage page once connected.
 */
export function CursorConnectPage(props: { onClose: () => void }) {
  const status = useCursorApiKeyStatusQuery();
  const saveKey = useSaveCursorApiKey();
  const disconnect = useDisconnectCursorApiKey();
  const [apiKey, setApiKey] = createSignal('');
  const loaded = () => status.isSuccess && !status.isPlaceholderData;
  const connected = () =>
    status.isSuccess && !status.isPlaceholderData
      ? status.data.registered
      : false;
  // The field mounts once status loads; focus it then, without scrolling the
  // guide's first step out of view.
  const focusOnMount = (input: HTMLInputElement) =>
    queueMicrotask(() => input.focus({ preventScroll: true }));

  const connect = async () => {
    const key = apiKey().trim();
    if (!key || saveKey.isPending) return;
    if (!isCursorApiKey(key)) {
      toast.failure(CURSOR_KEY_FORMAT_ERROR);
      return;
    }
    try {
      await saveKey.mutateAsync(key);
      setApiKey('');
      toast.success('Cursor connected');
    } catch (error) {
      toast.failure(
        failureMessage(error, 'Failed to save your Cursor API key')
      );
    }
  };

  const disconnectCursor = async () => {
    if (disconnect.isPending) return;
    const confirmed = await confirmDialog({
      title: 'Disconnect Cursor?',
      body: "Remove your Cursor connection from Macro? This removes Macro's copy of the API key but does not revoke it in Cursor.",
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!confirmed || disconnect.isPending) return;
    try {
      await disconnect.mutateAsync();
      toast.success('Cursor disconnected');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to disconnect Cursor'));
    }
  };

  return (
    <SettingsPage
      title={connected() ? 'Cursor' : 'Connect Cursor'}
      showTitleInSheet
      description="Run agents on your own Cursor subscription. Sessions run in Cursor Cloud and stream into Macro."
      actions={
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          <ArrowLeftIcon />
          Back
        </Button>
      }
    >
      <section aria-label="Connect Cursor">
        <SettingsSurface class="@container p-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <ol aria-label="Cursor setup steps" class="list-none">
              <SetupStep number={1} title="Create an API key in Cursor">
                <p>
                  In the Cursor dashboard, open{' '}
                  <span class="font-medium text-ink">API &amp; SSH Keys</span>{' '}
                  and click{' '}
                  <span class="font-medium text-ink">New API Key</span>.
                </p>
                <img
                  src={cursorApiKeysScreenshot}
                  alt="Cursor dashboard with API & SSH Keys selected and the New API Key button"
                  width={1200}
                  height={145}
                  class="block h-auto w-full rounded-[10px] border border-ink/10"
                />
                <SetupLink href={CURSOR_API_KEYS_URL}>
                  Open API &amp; SSH Keys
                </SetupLink>
              </SetupStep>
              <SetupStep number={2} title="Paste your API key">
                <p>
                  Macro stores it encrypted and only uses it to start and follow
                  your Cursor sessions.
                </p>
                <Show
                  when={loaded()}
                  fallback={
                    <p class="text-xs">
                      {status.isError
                        ? 'Could not load your Cursor connection. Try refreshing this page.'
                        : 'Loading…'}
                    </p>
                  }
                >
                  <Show
                    when={connected()}
                    fallback={
                      <div class="flex flex-col gap-1.5">
                        <label
                          for="cursor-api-key"
                          class="text-xs font-medium text-ink"
                        >
                          API key
                        </label>
                        <SetupField>
                          <input
                            ref={focusOnMount}
                            id="cursor-api-key"
                            type="password"
                            autocomplete="off"
                            spellcheck={false}
                            aria-describedby="cursor-api-key-help"
                            class="ph-no-capture min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none"
                            placeholder={CURSOR_KEY_PLACEHOLDER}
                            value={apiKey()}
                            disabled={saveKey.isPending}
                            onInput={(event) =>
                              setApiKey(event.currentTarget.value)
                            }
                          />
                        </SetupField>
                        <p
                          id="cursor-api-key-help"
                          class="text-xs text-ink-extra-muted"
                        >
                          You can remove the key at any time from this page.
                        </p>
                      </div>
                    }
                  >
                    <div class="flex flex-wrap items-center gap-3">
                      <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
                        Connected
                      </span>
                      <Show when={status.data?.updatedAt}>
                        {(updatedAt) => (
                          <span class="text-xs text-ink-muted">
                            Key saved{' '}
                            {new Date(updatedAt()).toLocaleDateString()}
                          </span>
                        )}
                      </Show>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="ml-auto text-negative"
                        disabled={disconnect.isPending}
                        onClick={() => void disconnectCursor()}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </Show>
                </Show>
              </SetupStep>
              <SetupStep number={3} title="Choose default model">
                <p>
                  New Cursor agents start with this model. You can change it per
                  agent.
                </p>
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">
                    Default model
                  </span>
                  <Show
                    when={connected()}
                    fallback={
                      <SetupField class="text-sm text-ink-muted">
                        <span aria-disabled="true">
                          Available once Cursor is connected
                        </span>
                      </SetupField>
                    }
                  >
                    <CursorDefaultModel triggerClass="flex w-full items-center justify-between gap-2 rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2 text-left text-sm text-ink outline-none transition-colors hover:border-ink/20 focus-visible:border-accent data-expanded:border-accent" />
                  </Show>
                  <p class="text-xs text-ink-extra-muted">
                    Used when an agent doesn’t pick its own.
                  </p>
                </div>
              </SetupStep>
            </ol>
            <div class="mt-6 flex justify-end gap-2 border-t border-edge-muted pt-4">
              <Show
                when={connected()}
                fallback={
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={props.onClose}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="cta"
                      size="sm"
                      disabled={!apiKey().trim() || saveKey.isPending}
                    >
                      {saveKey.isPending ? 'Connecting…' : 'Connect Cursor'}
                    </Button>
                  </>
                }
              >
                <Button
                  type="button"
                  variant="cta"
                  size="sm"
                  onClick={props.onClose}
                >
                  Done
                </Button>
              </Show>
            </div>
          </form>
        </SettingsSurface>
      </section>
    </SettingsPage>
  );
}
