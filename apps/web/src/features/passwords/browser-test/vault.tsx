import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { parseExportFile } from '@core/password-import/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { render } from 'solid-js/web';
import { PasswordsProvider } from '../context/passwords-context';
import { createFakePasswordSource } from '../tests/fake-source';
import {
  createMemoryImportResume,
  FIXTURE_SCOPE,
} from '../tests/fixture-scope';
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
// The first create of this folder name fails, as an unreachable vault would;
// the retry then succeeds.
const UNREACHABLE_FOLDER = 'Unreachable folder';
let folderCreateFailed = false;
let folderCreateAttempts = 0;
const createFolder = source.createFolder;
source.createFolder = async (name, parentId) => {
  if (name === UNREACHABLE_FOLDER) {
    folderCreateAttempts += 1;
    document.body.dataset.folderCreateAttempts = String(folderCreateAttempts);
  }
  if (name === UNREACHABLE_FOLDER && !folderCreateFailed) {
    folderCreateFailed = true;
    return err('failed');
  }
  return createFolder(name, parentId);
};
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
        // The real wasm parser in its worker (`just ensure-password-import-wasm`).
        parseExport: parseExportFile,
        importResume: createMemoryImportResume(),
      }}
    >
      <div class="relative h-dvh bg-panel text-ink">
        <VaultView />
        <FloatRegionHost />
        <ToastRegion />
      </div>
    </PasswordsProvider>
  </QueryClientProvider>
);
render(() => <View />, root);
