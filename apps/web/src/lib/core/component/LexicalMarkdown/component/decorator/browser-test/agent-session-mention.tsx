import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { buildAgentSessionMentionMarkdown } from '@macro-inc/lexical-core';
import { agentSessionKeys } from '@queries/agent-session/keys';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../../context/LexicalWrapperContext';
import { channelTheme } from '../../../theme';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '../../core/StaticMarkdown';

const id = 'session-mention-fixture';
const label = 'Fix mentions';
const mention = buildAgentSessionMentionMarkdown({ id, label });

function Fixture() {
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
        agentSessionKeys.preview(id, graphql).queryKey,
        accessible
          ? {
              access: 'access',
              data: {
                id,
                name: label,
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
              <main class="p-4 text-ink bg-page space-y-4">
                <For
                  each={[
                    mention,
                    `${mention} followed by text`,
                    `Before ${mention} after`,
                  ]}
                >
                  {(markdown) => (
                    <div
                      data-testid="sent-message"
                      class="w-96 border border-edge-muted p-2"
                    >
                      <StaticMarkdown markdown={markdown} target="internal" />
                    </div>
                  )}
                </For>
                <button onClick={() => setAccess(false)}>Revoke access</button>
              </main>
            </StaticMarkdownContext>
          </LexicalWrapperContext.Provider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
