import '@app/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { PasswordsProvider } from '../context/passwords-context';
import { createFakePasswordSource } from '../tests/fake-source';
import { VaultView } from '../views/vault-view';

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PasswordsProvider
        value={{
          source: createFakePasswordSource(),
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
        <div class="h-dvh">
          <VaultView teamId="fixture-team" />
        </div>
      </PasswordsProvider>
    </QueryClientProvider>
  ),
  root
);
