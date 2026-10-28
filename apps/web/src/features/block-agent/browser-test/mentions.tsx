import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { buildAgentSessionMentionMarkdown } from '@macro-inc/lexical-core';
import { agentSessionKeys } from '@queries/agent-session/keys';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { Message } from '../component/AgentMessage';

const SESSION_ID = 'session-mention-fixture';
const LABEL = 'Project notes';
const MENTION = buildAgentSessionMentionMarkdown({
  id: SESSION_ID,
  label: LABEL,
});

function Fixture() {
  const [stopped, setStopped] = createSignal(
    new URLSearchParams(location.search).has('stopped')
  );
  const literal = new URLSearchParams(location.search).has('literal');
  const reply = (): FoldedMessage => ({
    agentSessionId: 'fixture',
    turn: 1,
    author: { kind: 'agent' },
    parts: [
      {
        kind: 'text',
        text: literal
          ? 'Use `<m-document-mention>` as the tag name.'
          : `Here is ${MENTION}. The next reference is <m-document-mention>{"documentId":"unfinished`,
      },
    ],
    stop: stopped() ? { kind: 'cancelled' } : null,
    requestId: null,
    pending: false,
    postedAt: null,
    segments: [],
    phase: null,
  });
  const client = new QueryClient();
  const wrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'session-mention-fixture',
    isInteractable: () => false,
  });
  onCleanup(() => {
    wrapper.cleanup();
    client.clear();
  });
  const setAccess = (accessible: boolean) => {
    for (const graphql of [false, true]) {
      client.setQueryData(
        agentSessionKeys.preview(SESSION_ID, graphql).queryKey,
        accessible
          ? {
              access: 'access',
              data: {
                id: SESSION_ID,
                name: LABEL,
                ownerId: 'fixture-owner',
                botId: 'fixture-bot',
                status: { kind: 'disconnected' },
                createdAt: '',
                updatedAt: '',
              },
            }
          : { access: 'no_access' }
      );
    }
  };
  setAccess(true);
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <LexicalWrapperContext.Provider
            value={{ ...wrapper, skipPreviewFetch: true }}
          >
            <StaticMarkdownContext theme={channelTheme}>
              <main class="p-6 text-ink bg-page min-h-screen">
                <div class="max-w-2xl mx-auto space-y-6">
                  <h1 class="text-lg font-medium">Agent reply</h1>
                  <section aria-label="Agent reply">
                    <Message message={reply()} inFlight={!stopped()} />
                  </section>
                  <button
                    type="button"
                    disabled={stopped()}
                    onClick={() => {
                      const params = new URLSearchParams(location.search);
                      params.set('stopped', '');
                      history.replaceState(null, '', `?${params}`);
                      setStopped(true);
                    }}
                  >
                    {stopped() ? 'Stopped' : 'Stop response'}
                  </button>
                </div>
              </main>
            </StaticMarkdownContext>
          </LexicalWrapperContext.Provider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
