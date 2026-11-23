import '@app/index.css';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { GithubMessageView } from '../component/GithubMessageView';
import { buildTimeline } from '../data/timeline';
import { CODERABBIT_COMMENTS } from './fixtures';

initializeLexical();

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const entries = buildTimeline(CODERABBIT_COMMENTS, []);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <StaticMarkdownContext>
        <main class="h-dvh overflow-y-auto bg-page text-ink p-4 max-w-3xl">
          <For each={entries}>
            {(entry) =>
              entry.kind === 'github-comment' ? (
                <div data-testid={`comment-${entry.item.id}`}>
                  <GithubMessageView
                    comment={entry.item}
                    replies={entry.replies}
                  />
                </div>
              ) : null
            }
          </For>
        </main>
      </StaticMarkdownContext>
    </QueryClientProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
