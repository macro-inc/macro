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
// Shared with the viewer for viewing only: revealable, never editable.
const source = createFakePasswordSource([
  {
    item: {
      id: '019a0000-0000-7000-8000-0000000000aa',
      teamId: 'fixture-team',
      name: 'View-only login',
      kind: 'login',
      url: null,
      folderId: null,
      favorite: false,
      version: 1,
      hasTotp: false,
      shared: true,
      shareCount: 1,
      sharedWithTeam: false,
      canManage: false,
      canEdit: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    },
    values: {
      username: 'viewer-account',
      password: 'view-only-secret',
      notes: '',
      fields: [],
    },
  },
]);
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
