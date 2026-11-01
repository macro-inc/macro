import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { UploadResult } from '@channel/Input/utils/file-helpers';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createForwardMessageComposer,
  ForwardMessageComposer,
} from '../../ForwardMessageComposer';

function Draft() {
  const [pending, setPending] = createSignal<
    ((result: UploadResult) => void)[]
  >([]);
  const [sent, setSent] = createSignal('');
  const composer = createForwardMessageComposer({
    isSending: () => false,
    uploadFile: () =>
      new Promise((resolve) => setPending((current) => [...current, resolve])),
  });
  const finish = (failed: boolean) => {
    const uploads = pending();
    setPending([]);
    for (const resolve of uploads)
      resolve(
        failed
          ? { failed: true }
          : { failed: false, destination: 'static', id: crypto.randomUUID() }
      );
  };
  return (
    <>
      <section class="w-full max-w-xl border border-edge rounded-lg bg-surface overflow-hidden">
        <h1 class="text-base font-medium p-4 border-b border-edge-muted">
          Share document
        </h1>
        <ForwardMessageComposer composer={composer} />
        <div class="p-4 flex justify-end">
          <Button
            variant="primary"
            disabled={composer.isUploading()}
            onClick={() => {
              if (!composer.isUploading())
                setSent(JSON.stringify(composer.message()));
            }}
          >
            Share
          </Button>
        </div>
      </section>
      <div class="flex gap-2 my-4">
        <Button data-release-file>Read dropped file</Button>
        <Button disabled={!pending().length} onClick={() => finish(false)}>
          Finish uploads
        </Button>
        <Button disabled={!pending().length} onClick={() => finish(true)}>
          Fail uploads
        </Button>
      </div>
      <output aria-label="Sent message">{sent()}</output>
    </>
  );
}

function Fixture() {
  useHotKeyRoot();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const [open, setOpen] = createSignal(true);
  return (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelsContextProvider>
                <QuickAccessProvider>
                  <main class="min-h-screen bg-page p-4 text-ink">
                    <Button onClick={() => setOpen(!open())}>
                      {open() ? 'Close share' : 'Open share'}
                    </Button>
                    <Show when={open()}>
                      <Draft />
                    </Show>
                  </main>
                </QuickAccessProvider>
              </ChannelsContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(() => <Fixture />, root);
