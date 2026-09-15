import { AgentComposer } from '@app/features/block-agent/component/AgentComposer';
import { Transcript } from '@app/features/block-agent/component/Transcript';
import {
  AgentSessionProvider,
  useAgentSession,
} from '@app/features/block-agent/context/AgentSessionContext';
import {
  forgetPendingSession,
  pendingSession,
} from '@app/features/block-agent/context/pending-session';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { onCleanup, Show } from 'solid-js';

function AgentSessionContent() {
  const { loadFailed, loadRetryable, metadata, retryLoad, session } =
    useAgentSession();

  return (
    <>
      <header class="flex h-12 shrink-0 items-center border-b border-edge px-4">
        <h2 class="truncate text-sm font-semibold text-ink">
          {metadata()?.title ?? session()?.name ?? 'New Chat'}
        </h2>
      </header>
      <Show
        when={!loadFailed()}
        fallback={
          <LoadErrorPanel
            title="Unable to load this session"
            onRetry={loadRetryable() ? retryLoad : undefined}
          />
        }
      >
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <Transcript />
        </div>
        <div class="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4">
          <AgentComposer autofocus />
        </div>
      </Show>
    </>
  );
}

export function AgentSessionPane(props: {
  id: string;
  onSessionId: (sessionId: string) => void;
}) {
  const pending = pendingSession(props.id);
  onCleanup(() => {
    if (pending?.sessionId() || pending?.failed()) {
      forgetPendingSession(props.id);
    }
  });

  return (
    <AgentSessionProvider blockId={props.id} onSessionId={props.onSessionId}>
      <AgentSessionContent />
    </AgentSessionProvider>
  );
}
