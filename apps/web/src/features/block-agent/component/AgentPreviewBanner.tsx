import { useUserId } from '@core/context/user';
import { useAgentPreview } from '@queries/agent-session/preview';
import { createSignal, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';

/** Persistent session preview state, independent of transcript/tool-call rendering. */
export function AgentPreviewBanner() {
  const { sessionId, session } = useAgentSession();
  const userId = useUserId();
  const preview = useAgentPreview(sessionId);
  const state = () =>
    preview.query.isSuccess ? preview.query.data.preview : undefined;
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const open = async () => {
    // Reserve the tab in the click gesture, before waiting for authorization.
    const tab = window.open('', '_blank');
    if (!tab) {
      setError('Allow popups to open the preview.');
      return;
    }
    tab.opener = null;
    tab.document.title = 'Opening preview…';
    tab.document.body.textContent = 'Opening preview…';
    setError(undefined);
    setBusy(true);
    try {
      const launch = await preview.open();
      if (tab.closed) return;
      if (
        launch.action !== `${state()?.url}/.macro-preview/auth` ||
        !launch.action.startsWith('https://')
      )
        throw new Error('Invalid preview destination');
      const policy = tab.document.createElement('meta');
      policy.name = 'referrer';
      policy.content = 'strict-origin';
      tab.document.head.append(policy);
      const form = tab.document.createElement('form');
      form.method = 'POST';
      form.action = launch.action;
      const input = tab.document.createElement('input');
      input.type = 'hidden';
      input.name = 'ticket';
      input.value = launch.ticket;
      form.append(input);
      tab.document.body.replaceChildren(form);
      form.submit();
    } catch {
      tab.close();
      setError(
        'Unable to open this preview. It may have ended or your access may have changed.'
      );
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await preview.stop();
    } catch {
      setError('Unable to stop sharing. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const label = () => {
    switch (state()?.status) {
      case 'starting':
        return 'Agent is connecting a preview…';
      case 'ready':
        return 'Agent is sharing a preview';
      case 'expired':
        return 'Preview expired. Ask the agent to share again.';
      case 'offline':
        return 'Preview disconnected. Ask the agent to reconnect.';
      case 'stopped':
        return 'Preview sharing stopped';
      default:
        return '';
    }
  };
  return (
    <Show when={state()}>
      <div
        class="shrink-0 border-b border-edge bg-panel px-4 py-2 text-sm"
        aria-live="polite"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-ink">{label()}</span>
          <Show when={state()?.status === 'ready'}>
            <button
              type="button"
              class="text-accent hover:underline disabled:opacity-50"
              disabled={busy()}
              onClick={open}
            >
              View preview ↗
            </button>
          </Show>
          <Show
            when={
              session()?.ownerId === userId() &&
              (state()?.status === 'ready' || state()?.status === 'starting')
            }
          >
            <button
              type="button"
              class="text-ink-muted hover:underline disabled:opacity-50"
              disabled={busy()}
              onClick={stop}
            >
              Stop sharing
            </button>
          </Show>
        </div>
        <Show when={error()}>
          <p role="alert" class="mt-1 text-ink-muted">
            {error()}
          </p>
        </Show>
      </div>
    </Show>
  );
}
