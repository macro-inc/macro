import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { PasswordsProvider } from '../context/passwords-context';
import { createFakePasswordSource } from '../tests/fake-source';
import { FIXTURE_SCOPE } from '../tests/fixture-scope';
import { VaultView } from '../views/vault-view';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
const source = createFakePasswordSource();
const View = () => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <PasswordsProvider
      value={{
        scope: FIXTURE_SCOPE,
        source,
        recipients: () => [
          { id: 'fixture-person', name: 'Avery Lee', kind: 'user' },
          { id: 'fixture-team', name: 'Product team', kind: 'team' },
        ],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async (value) => {
          document.body.dataset.copied = value;
        },
      }}
    >
      <div class="relative h-dvh bg-panel text-ink">
        <VaultView />
        <FloatRegionHost />
      </div>
    </PasswordsProvider>
  </QueryClientProvider>
);
render(() => <View />, root);
