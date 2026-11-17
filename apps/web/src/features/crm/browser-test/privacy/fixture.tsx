import '../../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  CrmEmailOptInBanner,
  CrmEmailPrivacyDialog,
} from '../../views/email-privacy';
import { PrivacyNavigationFixture } from './navigation-fixture';
import { lastChange, lastToast } from './preview-adapters';
import { ThreadMenuFixture } from './thread-menu-fixture';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'member@example.com',
  authenticated: true,
});

function Fixture() {
  const [open, setOpen] = createSignal(false);
  return (
    <main class="min-h-dvh bg-page text-ink">
      <CrmEmailOptInBanner />
      <output data-testid="toast">{lastToast()}</output>
      <div class="p-6">
        <Button onClick={() => setOpen(true)}>Email settings</Button>
        <ThreadMenuFixture />
        <pre class="overflow-auto text-xs" data-testid="last-change">
          {lastChange()}
        </pre>
      </div>
      <CrmEmailPrivacyDialog open={open()} onOpenChange={setOpen} />
    </main>
  );
}
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <PrivacyNavigationFixture>
          <Fixture />
        </PrivacyNavigationFixture>
      </QueryClientProvider>
    ),
    root
  );
