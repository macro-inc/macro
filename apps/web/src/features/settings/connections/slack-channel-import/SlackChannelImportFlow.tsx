import { SLACK_CONNECT_SLUG } from '@core/pipedream/slugs';
import { connectPipedreamApp } from '@queries/pipedream-connectors';
import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { SettingsPage } from '../../primitives';
import { SlackChannelImportCard } from './SlackChannelImportCard';

/** Continue through authorization into channel selection. */
export function SlackChannelImportFlow(props: {
  connected: boolean;
  onBack(): void;
}) {
  const [authorized, setAuthorized] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function connect() {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await connectPipedreamApp({
        appSlug: SLACK_CONNECT_SLUG,
        serverName: 'Slack',
      });
      if (disposed) return;
      if (outcome === 'connected') setAuthorized(true);
      if (outcome === 'unsupported')
        setError('Slack connections are not available on this deployment.');
    } catch {
      if (!disposed) setError('Could not connect Slack. Please try again.');
    } finally {
      if (!disposed) setBusy(false);
    }
  }
  onMount(() => {
    if (!props.connected) void connect();
  });

  return (
    <SettingsPage
      title="Import channels without history"
      description="Copy public channel names and matching teammates into Macro. Messages stay in Slack; channels do not sync."
      onBack={props.onBack}
      backLabel="Connections"
    >
      <Show
        when={props.connected || authorized()}
        fallback={
          <div class="space-y-3 text-sm text-ink-muted">
            <p>
              Connect your Slack account to choose channels. No Slack admin role
              is needed, but your workspace may require app approval.
            </p>
            <Show when={error()}>
              {(message) => (
                <p role="alert" class="text-failure">
                  {message()}
                </p>
              )}
            </Show>
            <Button
              variant="accent"
              disabled={busy()}
              onClick={() => void connect()}
            >
              {busy() ? 'Connecting Slack…' : 'Connect Slack to continue'}
            </Button>
          </div>
        }
      >
        <SlackChannelImportCard autoDiscover />
      </Show>
    </SettingsPage>
  );
}
