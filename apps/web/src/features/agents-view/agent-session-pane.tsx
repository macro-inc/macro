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
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Button } from '@ui';
import { onCleanup, Show } from 'solid-js';

function SessionContent(props: { id: string }) {
  const session = useAgentSession();
  const pending = pendingSession(props.id);
  return (
    <StaticMarkdownContext>
      <header class="flex h-12 shrink-0 items-center  px-4">
        <h2 class="truncate text-sm font-semibold">
          {session.session()?.name ?? 'New Chat'}
        </h2>
      </header>
      <Show
        when={session.loadFailed()}
        fallback={
          <>
            <div class="flex min-h-0 flex-1 overflow-hidden">
              <Transcript />
            </div>
            <div class="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4">
              <Show when={pending?.promptFailed()}>
                <p class="mb-2 text-sm text-ink-muted">
                  Your first message was not sent: {pending?.initialPrompt}
                </p>
                <Button
                  variant="ghost"
                  onClick={() => void pending?.retryPrompt()}
                >
                  Retry message
                </Button>
              </Show>
              <AgentComposer />
            </div>
          </>
        }
      >
        <div class="p-6 text-sm text-ink-muted">
          Unable to load this session.
          <Show when={pending?.initialPrompt}>
            <p class="mt-3 whitespace-pre-wrap">
              Unsent message: {pending?.initialPrompt}
            </p>
          </Show>
          <Show when={session.loadRetryable()}>
            <Button variant="ghost" onClick={session.retryLoad}>
              Retry
            </Button>
          </Show>
        </div>
      </Show>
    </StaticMarkdownContext>
  );
}

export function AgentSessionPane(props: { id: string }) {
  onCleanup(() => {
    const pending = pendingSession(props.id);
    if (pending?.sessionId() && !pending.promptFailed())
      forgetPendingSession(props.id);
  });
  return (
    <AgentSessionProvider blockId={props.id}>
      <SessionContent id={props.id} />
    </AgentSessionProvider>
  );
}
