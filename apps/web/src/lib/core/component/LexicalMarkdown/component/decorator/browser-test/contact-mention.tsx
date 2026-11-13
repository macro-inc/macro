import '@app/index.css';
import { Content } from '@app/features/channel/Message/Content';
import { MessageProvider } from '@app/features/channel/Message/context';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { MessageData } from '@core/messages/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { initializeLexical } from '../../../init';
import { StaticMarkdownContext } from '../../core/StaticMarkdown';

initializeLexical();
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const PERSON =
  'firstname.middlename.lastname.department@subdivision.example.com';
const COMPANY = '@subdivision.example-company-with-a-long-domain-name.com';

const contact = (info: object) =>
  `<m-contact-mention>${JSON.stringify(info)}</m-contact-mention>`;

const MESSAGES = [
  {
    label: 'Person',
    content: `Ask ${contact({ contactId: 'person', name: PERSON, emailOrDomain: PERSON, isCompany: false })} about the renewal`,
  },
  {
    label: 'Company',
    content: `Loop in ${contact({ contactId: 'company', name: 'Example', emailOrDomain: COMPANY, isCompany: true })} too`,
  },
];

function message(id: string, content: string): MessageData {
  return {
    id,
    content,
    sender_id: 'macro|sender@example.com',
    created_at: '2026-11-13T12:00:00Z',
    updated_at: '2026-11-13T12:00:00Z',
    attachments: [],
    reactions: [],
  };
}

/** A sent message's real body, recording every height it takes from mount. */
function SentMessage(props: { label: string; content: string }) {
  const [heights, setHeights] = createSignal<number[]>([]);
  const observer = new ResizeObserver(([entry]) => {
    const height = Math.round(entry.borderBoxSize[0].blockSize);
    setHeights((prev) => (prev.at(-1) === height ? prev : [...prev, height]));
  });
  onCleanup(() => observer.disconnect());
  return (
    <section aria-label={props.label} class="space-y-1">
      <div ref={(element) => observer.observe(element)} data-testid="message">
        <MessageProvider value={() => message(props.label, props.content)}>
          <Content />
        </MessageProvider>
      </div>
      <div data-testid="height-history" class="text-xs text-ink-muted">
        {heights().join(',')}
      </div>
    </section>
  );
}

/** Channel messages in a pane as wide as `?width=` (a narrow split), or the window. */
function Fixture() {
  const width = new URLSearchParams(location.search).get('width');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <StaticMarkdownContext>
            <main
              data-testid="pane"
              class="bg-page text-ink h-dvh overflow-auto p-4 space-y-6"
              style={{ width: width ? `${width}px` : undefined }}
            >
              <For each={MESSAGES}>
                {(item) => (
                  <SentMessage label={item.label} content={item.content} />
                )}
              </For>
            </main>
          </StaticMarkdownContext>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
