import type { ParsedImport, ParseReply } from '@core/password-import/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { ImportBatchBody } from '../context/passwords-context';
import {
  type PasswordSource,
  PasswordsProvider,
} from '../context/passwords-context';
import type { PasswordItem } from '../core/types';
import { ImportDialog } from '../views/import-dialog';
import { createFakePasswordSource } from './fake-source';
import { createMemoryImportResume, FIXTURE_SCOPE } from './fixture-scope';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EXPORT: ParsedImport = {
  format: 'bitwarden_json',
  summary: {
    itemsByKind: { login: 2, note: 1 },
    folders: 1,
    skippedByReason: { trashed: 1 },
    droppedByPart: { password_history: 2 },
  },
  folders: [{ key: 'folder:0', name: 'Work', parentKey: null, path: ['Work'] }],
  items: [
    {
      sourceKey: 'bw-1',
      name: 'Fixture Mail',
      kind: 'login',
      url: 'https://mail.example.test',
      folderKey: 'folder:0',
      favorite: false,
      values: { username: 'fake', password: 'fake', notes: '', fields: [] },
      totp: null,
    },
    {
      sourceKey: 'bw-2',
      name: 'Fixture Wiki',
      kind: 'login',
      url: 'https://wiki.example.test',
      folderKey: null,
      favorite: true,
      values: { username: 'fake', password: 'fake', notes: '', fields: [] },
      totp: null,
    },
    {
      sourceKey: 'bw-3',
      name: 'Fixture note',
      kind: 'note',
      url: null,
      folderKey: null,
      favorite: false,
      values: { username: '', password: '', notes: 'fake', fields: [] },
      totp: null,
    },
  ],
  skipped: [{ sourceKey: 'bw-4', name: 'Old login', reason: 'trashed' }],
  dropped: [{ sourceKey: 'bw-1', what: 'password_history', count: 2 }],
};

const EXISTING: PasswordItem = {
  id: '019a0000-0000-7000-8000-0000000000bb',
  teamId: 'fixture-team',
  name: 'Fixture Wiki',
  kind: 'login',
  url: 'https://wiki.example.test/start',
  folderId: null,
  favorite: false,
  version: 1,
  hasTotp: false,
  shared: false,
  shareCount: 0,
  sharedWithTeam: true,
  canManage: true,
  canEdit: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  lastUsedAt: null,
};

function chooseFileOnClick(file: File) {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    Object.defineProperty(this, 'files', { value: [file], configurable: true });
    this.dispatchEvent(new Event('change'));
  });
}

function mount(
  source: PasswordSource,
  reply: ParseReply,
  importResume = createMemoryImportResume()
) {
  const onOpenFolder = vi.fn();
  render(() => (
    <PasswordsProvider
      value={{
        scope: FIXTURE_SCOPE,
        source,
        recipients: () => [],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async () => {},
        parseExport: async () => reply,
        importResume,
      }}
    >
      <ImportDialog
        items={() => [EXISTING]}
        folders={() => []}
        refresh={async () => {}}
        onOpenFolder={onOpenFolder}
        onClose={() => {}}
      />
    </PasswordsProvider>
  ));
  return { onOpenFolder };
}

it('previews an export, skips what the vault already has, and imports the rest', async () => {
  const source = createFakePasswordSource([
    {
      item: EXISTING,
      values: { username: '', password: '', notes: '', fields: [] },
    },
  ]);
  const { onOpenFolder } = mount(source, { outcome: 'parsed', export: EXPORT });
  chooseFileOnClick(new File(['{}'], 'export.json'));

  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText('Bitwarden JSON');
  expect(screen.getByText('Work')).toBeTruthy();
  expect(screen.getAllByText('In the trash').length).toBeGreaterThan(0);
  expect(screen.getByText('Old login')).toBeTruthy();
  expect(screen.getByText('2 previous passwords')).toBeTruthy();
  expect(
    screen.getByText('1 item looks like one you already have.')
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));

  await screen.findByText('Import finished');
  expect(screen.getByText('2 imported')).toBeTruthy();
  // One duplicate left out by choice, one trashed in the source.
  expect(screen.getByText('2 skipped')).toBeTruthy();
  const listed = await source.list();
  expect(listed.map((item) => item.name).sort()).toEqual([
    'Fixture Mail',
    'Fixture Wiki',
    'Fixture note',
  ]);

  const note = listed.find((item) => item.name === 'Fixture note');
  expect(note?.folderId).toMatch(/:target$/);
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
  expect(onOpenFolder).toHaveBeenCalledWith(expect.stringMatching(/:target$/));
});

it('imports duplicates too when asked', async () => {
  const source = createFakePasswordSource();
  mount(source, { outcome: 'parsed', export: EXPORT });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Bitwarden JSON');

  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Skip items I already have' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import 3 items' }));

  await screen.findByText('3 imported');
});

it('says why a file cannot be read, without its contents', async () => {
  mount(createFakePasswordSource(), {
    outcome: 'failed',
    error: { code: 'encrypted_bitwarden' },
  });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'This Bitwarden export is encrypted.'
    )
  );
});

it('continues an unfinished import of the same file with the same import id', async () => {
  const requests: ImportBatchBody[] = [];
  const source = createFakePasswordSource([], {
    requests,
    busy: new Map([['bw-3', 3]]),
  });
  const resume = createMemoryImportResume();
  const file = new File(['{}'], 'export.json');
  mount(source, { outcome: 'parsed', export: EXPORT }, resume);
  chooseFileOnClick(file);
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Bitwarden JSON');
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
  // Two real backoff waits before the busy item is given up on.
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  cleanup();

  mount(source, { outcome: 'parsed', export: EXPORT }, resume);
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText(
    'Continuing an earlier import of this file. Items already imported are not added again.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
  await screen.findByText('1 already present');
  expect(screen.getByText('1 imported')).toBeTruthy();
  const ids = new Set(requests.map((request) => request.items[0]?.sourceKey));
  expect(ids.has('bw-1')).toBe(true);
});
