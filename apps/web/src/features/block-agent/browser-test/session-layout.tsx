import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { AgentComposerRegion } from '../component/AgentComposerRegion';
import { Transcript } from '../component/Transcript';
import { session, showTranscript } from './session';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

const message = (
  turn: number,
  author: 'user' | 'agent',
  text: string
): FoldedMessage => ({
  agentSessionId: session.sessionId(),
  key: `${turn}:${author}`,
  turn,
  author:
    author === 'user'
      ? { kind: 'user', userId: session.userId() }
      : { kind: 'agent' },
  parts: [{ kind: 'text', text }],
  requestId: null,
  stop: author === 'agent' ? { kind: 'end_turn' } : null,
  pending: false,
  segments: [],
  phase: null,
  postedAt: null,
});

const paragraph =
  'The agent explains what it found in a few sentences, long enough to wrap across several lines of the transcript.';
showTranscript(
  Array.from({ length: 12 }, (_, index) => [
    message(index * 2, 'user', `Question ${index}`),
    message(
      index * 2 + 1,
      'agent',
      `Answer ${index}. ${paragraph}\n\n${paragraph}`
    ),
  ]).flat(),
  'idle'
);

/**
 * An agent session's layout: the real transcript, with a composer in the
 * same region a session gives it (floating over the pane on touch, in flow
 * on desktop). The composer itself is a stand-in box of composer height.
 */
function Fixture() {
  return (
    <main class="relative flex h-dvh flex-col bg-surface">
      <Transcript />
      <AgentComposerRegion>
        <div class="flex w-full justify-center px-4 pb-2.5 pointer-events-auto touch:px-(--mobile-chrome-gutter) touch:pb-0">
          <div
            data-testid="composer"
            class="flex h-24 w-full max-w-[896px] items-end justify-end rounded-[28px] bg-composer p-3 touch:rounded-3xl touch:island touch:bg-chrome"
          >
            <button
              type="button"
              class="size-9 rounded-full bg-ink text-surface"
            >
              ↑
            </button>
          </div>
        </div>
      </AgentComposerRegion>
      <Show when={isTouchDevice()}>
        <FloatRegionHost />
      </Show>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={new QueryClient()}>
      <UserContextProvider>
        <StaticMarkdownContext>
          <Fixture />
        </StaticMarkdownContext>
      </UserContextProvider>
    </QueryClientProvider>
  ),
  root
);
