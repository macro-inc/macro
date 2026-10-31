import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { ComposerEditor } from '../../ComposerEditor';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

const url = 'https://apps.apple.com/us/app/macro-app/id6743133649';
const original = `hey! can you rate the Macro app on the App Store (5 stars if you're feeling it) and leave a quick review if you can? takes 30 seconds:\n${url}\n\n(sent by @macro on behalf of Jacob)`;

function Fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const [saved, setSaved] = createSignal('');
  const editor = buildConfig('chat')
    .namespace('links-fixture')
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' });
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <UserContextProvider>
            <StaticMarkdownContext>
              <main class="bg-page text-ink h-dvh overflow-y-auto p-6 space-y-6 max-w-3xl mx-auto">
                <h1 class="text-xl font-medium">Message links</h1>
                <section
                  data-testid="original"
                  class="border border-edge rounded p-4"
                >
                  <p class="font-medium mb-3">Macro · Agent</p>
                  <StaticMarkdown markdown={original} />
                </section>
                <section
                  data-testid="explicit"
                  class="border border-edge rounded p-4"
                >
                  <StaticMarkdown
                    markdown={`here's the clickable link: [Rate Macro on the App Store](${url})`}
                  />
                </section>
                <section
                  data-testid="cases"
                  class="border border-edge rounded p-4"
                >
                  <StaticMarkdown
                    markdown={
                      'Encoded path: https://example.com/a%20b?q=x%2Fy#part\n\nURL punctuation: https://example.com/a~~b~~c\n\nLiteral code: `https://example.com/code`\n\nRemoved link: <m-link>{"url":"https://example.com/removed","text":"https://example.com/removed","unlinked":true}</m-link>'
                    }
                  />
                </section>
                <section class="border border-edge rounded p-4 space-y-3">
                  <h2>Edit and save a link</h2>
                  <ComposerEditor
                    config={editor}
                    initialValue={url}
                    ariaLabel="Message"
                  />
                  <button
                    class="border border-edge rounded px-3 py-1"
                    onClick={() => setSaved(editor.controls.getMarkdown())}
                  >
                    Save message
                  </button>
                  <div data-testid="saved">
                    <StaticMarkdown markdown={saved()} />
                  </div>
                  <button
                    class="border border-edge rounded px-3 py-1"
                    onClick={() => editor.controls.setMarkdown(saved())}
                  >
                    Reopen saved message
                  </button>
                </section>
              </main>
            </StaticMarkdownContext>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
