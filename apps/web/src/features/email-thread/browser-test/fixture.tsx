import '@fontsource-variable/inter';
import '../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessList } from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { EmailThreadHost } from '../context/email-thread-context';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { EmailThreadSurface } from '../views/email-thread-surface';
import { createFakeCompose } from './fake-compose';

/**
 * The real thread view, message bodies, and reply composer over a fake thread
 * source and compose backend. The host registers Escape like the Email view's
 * inline detail does, and returning to the list unmounts the thread.
 * `?draft` adds a saved reply to the latest message.
 */
const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const messages = [
  message('first', {
    from: { email: 'billing@example.com', name: 'Billing' },
    internal_date_ts: '2026-09-01T10:00:00Z',
    body_html_sanitized: '<p>Your invoice is on its way.</p>',
  }),
  message('last', {
    from: { email: 'billing@example.com', name: 'Billing' },
    internal_date_ts: '2026-09-02T10:00:00Z',
    body_html_sanitized: `<div><p>Here is the invoice for September.</p><p><a href="https://example.com/invoice">View invoice</a></p><img src="${LOGO}" alt="Company logo" width="160" height="40"></div>`,
  }),
  ...(new URLSearchParams(location.search).has('draft')
    ? [
        message('saved-reply', {
          is_draft: true,
          replying_to_id: 'last',
          internal_date_ts: '2026-09-03T10:00:00Z',
          body_html_sanitized: btoa('<p>Saved reply</p>'),
        }),
      ]
    : []),
];

const [savedDrafts, setSavedDrafts] = createSignal<string[]>([]);
const [deletedDrafts, setDeletedDrafts] = createSignal<string[]>([]);

function Thread(props: { onReturnToList: () => void }) {
  const [attachScope, scope] = useHotkeyDOMScope('split');
  let container!: HTMLDivElement;
  onMount(() => {
    attachScope(container);
    container.focus({ preventScroll: true });
  });
  const host: EmailThreadHost = {
    returnToList: props.onReturnToList,
    focusContainer: () => container.focus({ preventScroll: true }),
    registerKeyboard: (handlers) => {
      for (const [hotkey, keyDownHandler] of [
        ['r', handlers.replyToFocusedMessage],
        ['f', handlers.forwardFocusedMessage],
        ['arrowup', handlers.navigateToPreviousMessage],
        ['arrowdown', handlers.navigateToNextMessage],
        ['escape', handlers.cancel],
      ] as const) {
        registerHotkey({
          hotkey,
          scopeId: scope,
          description: hotkey,
          keyDownHandler,
        });
      }
    },
  };
  return (
    <div
      ref={container}
      tabIndex={-1}
      class="mx-auto flex h-screen max-w-3xl flex-col outline-none"
    >
      <EmailThreadSurface
        title="Invoice"
        threadId={() => 'thread'}
        host={host}
        context={{
          thread: createThreadContext({ thread: () => thread(messages) }),
          compose: createFakeCompose({
            saved: (body) => setSavedDrafts((bodies) => [...bodies, body]),
            deleted: (id) => setDeletedDrafts((ids) => [...ids, id]),
          }),
          rendering: {},
        }}
        emailRendering={{
          theme: () => ({
            inkL: 0.2,
            inkC: 0,
            inkH: 0,
            panelL: 1,
            accentL: 0.5,
            accentC: 0.1,
            accentH: 250,
          }),
          images: { remote: 'allow' },
          resolveImages: async () => {},
        }}
      />
    </div>
  );
}

function Fixture() {
  useHotKeyRoot();
  const [open, setOpen] = createSignal(true);
  return (
    <main
      ref={(element) => attachGlobalDOMScope(element)}
      class="min-h-screen bg-surface text-ink"
    >
      <Show
        when={open()}
        fallback={
          <section aria-label="Inbox" class="p-8">
            <h1 class="text-lg">Inbox</h1>
          </section>
        }
      >
        <Thread onReturnToList={() => setOpen(false)} />
      </Show>
      <output class="sr-only" data-testid="saved-drafts">
        {savedDrafts().join('\n')}
      </output>
      <output class="sr-only" data-testid="deleted-drafts">
        {deletedDrafts().join('\n')}
      </output>
    </main>
  );
}

// The editor's menus and recipient fields read the viewer, channels, and
// workspace search; this fixture has none of them, and no backend.
const queryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});
const noItems: QuickAccessList<never> = {
  items: () => [],
  totalCount: () => 0,
  hasMore: () => false,
  isLoading: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
};
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <QuickAccessContextProvider
          value={{
            useList: () => noItems,
            usesRecordSelection: () => false,
            usesSearchProjection: () => false,
            isLoading: () => false,
            refresh() {},
            getById: () => undefined,
          }}
        >
          <UserContextProvider>
            <ChannelsContextProvider>
              <Fixture />
            </ChannelsContextProvider>
          </UserContextProvider>
        </QuickAccessContextProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  root
);
