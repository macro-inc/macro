import type { ParsedImport, ParseReply } from '@core/password-import/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ImportBatchBody } from '../context/passwords-context';
import {
  type PasswordSource,
  PasswordsProvider,
} from '../context/passwords-context';
import type {
  PasswordFolder as Folder,
  PasswordFolder,
  PasswordItem,
} from '../core/types';
import { ImportDialog } from '../views/import-dialog';
import { createFakePasswordSource } from './fake-source';
import { createMemoryImportResume, FIXTURE_SCOPE } from './fixture-scope';

// The dialog body scrolls through `Scroll`, which jsdom cannot measure.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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

const PARSED = {
  outcome: 'parsed',
  export: EXPORT,
  fileHash: 'a'.repeat(64),
} as const satisfies ParseReply;

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
  importResume = createMemoryImportResume(),
  vault: { items?: PasswordItem[]; folders?: PasswordFolder[] } = {}
) {
  const onOpenFolder = vi.fn();
  const onClose = vi.fn();
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
        items={() => vault.items ?? [EXISTING]}
        folders={() => vault.folders ?? []}
        refresh={async () => {}}
        onOpenFolder={onOpenFolder}
        onClose={onClose}
      />
    </PasswordsProvider>
  ));
  return { onOpenFolder, onClose };
}

it('previews an export, skips what the vault already has, and imports the rest', async () => {
  const source = createFakePasswordSource([
    {
      item: EXISTING,
      values: { username: '', password: '', notes: '', fields: [] },
    },
  ]);
  const { onOpenFolder } = mount(source, PARSED);
  chooseFileOnClick(new File(['{}'], 'export.json'));

  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText('Bitwarden JSON');
  expect(screen.getByText('Work')).toBeTruthy();
  expect(screen.getAllByText('In the trash').length).toBeGreaterThan(0);
  expect(screen.getByText('Old login')).toBeTruthy();
  expect(screen.getByText('Previous passwords')).toBeTruthy();
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
  mount(source, PARSED);
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
  mount(source, PARSED, resume);
  chooseFileOnClick(file);
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Bitwarden JSON');
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
  // Two real backoff waits before the busy item is given up on.
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  expect(screen.getByText('The vault was busy (1)')).toBeTruthy();
  cleanup();

  mount(source, PARSED, resume);
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText(
    'Continuing an earlier import of this file, into the same place and with the same privacy. Items already imported are not added again.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
  await screen.findByText('1 already present');
  expect(screen.getByText('1 imported')).toBeTruthy();
  const ids = new Set(requests.map((request) => request.items[0]?.sourceKey));
  expect(ids.has('bw-1')).toBe(true);
});

it('asks for a supported export when the layout is too old', async () => {
  mount(createFakePasswordSource(), {
    outcome: 'failed',
    error: { code: 'unsupported_version' },
  });
  chooseFileOnClick(new File(['{}'], 'export.csv'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'export a .1pux file or a 1Password 8 CSV'
    )
  );
});

it('names the new folder apart from one an earlier import made', async () => {
  const source = createFakePasswordSource();
  const earlier = `Imported from Bitwarden ${new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
  }).format(new Date())}`;
  mount(source, PARSED, undefined, {
    items: [],
    folders: [{ id: 'earlier', name: earlier, parentId: null }],
  });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText(`New folder “${earlier} (2)”`);
  fireEvent.click(screen.getByRole('button', { name: 'Import 3 items' }));
  await screen.findByText('Import finished');

  const folders = await source.folders();
  expect(folders.map((folder) => folder.name)).toContain(`${earlier} (2)`);
});

it('offers Done and says how to import anyway when everything is already there', async () => {
  const source = createFakePasswordSource();
  const vaultCopy = (
    sourceItem: (typeof EXPORT.items)[number],
    index: number
  ) => ({
    ...EXISTING,
    id: `019a0000-0000-7000-8000-00000000000${index}`,
    name: sourceItem.name,
    kind: sourceItem.kind,
    url: sourceItem.url,
  });
  const { onClose } = mount(source, PARSED, undefined, {
    items: EXPORT.items.map(vaultCopy),
  });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText(
    'Everything in this file is already in the vault. Turn off Skip items I already have to import copies anyway.'
  );
  expect(screen.queryByRole('button', { name: /^Import \d/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onClose).toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Skip items I already have' })
  );
  expect(screen.getByRole('button', { name: 'Import 3 items' })).toBeTruthy();
});

it('lists the skipped items behind Show items, counting each reason once', async () => {
  mount(createFakePasswordSource(), PARSED);
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText('Show items');
  expect(screen.queryByText('1 item')).toBeNull();
});

it('finishes a verification code an earlier run could not set up, even beside a look-alike', async () => {
  const totpExport: ParsedImport = {
    ...EXPORT,
    items: EXPORT.items
      .slice(0, 1)
      .map((item) => ({ ...item, totp: 'JBSWY3DPEHPK3PXP' })),
    skipped: [],
    dropped: [],
  };
  // An older item the export's item looks like (same kind, name and host).
  const lookAlike: PasswordItem = {
    ...EXISTING,
    name: 'Fixture Mail',
    url: 'https://mail.example.test',
  };
  const source = createFakePasswordSource(
    [
      {
        item: lookAlike,
        values: { username: '', password: '', notes: '', fields: [] },
      },
    ],
    // Fails in every retry round of the first run, then works.
    { totpFailures: new Map([['bw-1', 3]]) }
  );
  const resume = createMemoryImportResume();
  const reply = {
    outcome: 'parsed',
    export: totpExport,
    fileHash: 'b'.repeat(64),
  } as const;
  // The vault list the dialog sees, as the view refreshes it after a run.
  const [vaultItems, setVaultItems] = createSignal<PasswordItem[]>([lookAlike]);
  const mountWithVault = () =>
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
          importResume: resume,
        }}
      >
        <ImportDialog
          items={vaultItems}
          folders={() => []}
          refresh={async () => {
            setVaultItems(await source.list());
          }}
          onOpenFolder={() => {}}
          onClose={() => {}}
        />
      </PasswordsProvider>
    ));
  chooseFileOnClick(new File(['{}'], 'export.json'));
  const imported = async () =>
    (await source.list()).find((item) => item.id !== lookAlike.id);

  mountWithVault();
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  // Imported next to the look-alike on purpose.
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'Skip items I already have' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 item' }));
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  expect((await imported())?.hasTotp).toBe(false);
  cleanup();

  mountWithVault();
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText(/^Continuing an earlier import of this file/);
  // Skip is on again, but the unfinished item is never taken for a duplicate.
  expect(screen.queryByText(/look like ones you already have/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 item' }));
  await screen.findByText('1 already present');
  expect((await imported())?.hasTotp).toBe(true);
});

it('keeps the destination and privacy of the import it continues', async () => {
  const source = createFakePasswordSource([], { busy: new Map([['bw-3', 3]]) });
  const resume = createMemoryImportResume();
  chooseFileOnClick(new File(['{}'], 'export.json'));
  mount(source, PARSED, resume, { items: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  fireEvent.click(
    await screen.findByRole('checkbox', {
      name: 'Keep imported items private to me',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import 3 items' }));
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  cleanup();

  mount(source, PARSED, resume, { items: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  const keepPrivate = await screen.findByRole('checkbox', {
    name: 'Keep imported items private to me',
  });
  expect((keepPrivate as HTMLInputElement).checked).toBe(true);
  expect((keepPrivate as HTMLInputElement).disabled).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it('matches names in the vault, in a request body, when its list is capped', async () => {
  const matchRequests: string[][] = [];
  // The duplicate is in the vault but not among the 500 items the list loaded.
  const source = createFakePasswordSource(
    [
      {
        item: EXISTING,
        values: { username: '', password: '', notes: '', fields: [] },
      },
    ],
    { matchRequests }
  );
  const loaded = Array.from({ length: 500 }, (_, index) => ({
    ...EXISTING,
    id: `019a0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    name: `Filler ${index}`,
  }));
  mount(source, PARSED, undefined, { items: loaded });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText('1 item looks like one you already have.');
  expect(matchRequests).toEqual([
    ['fixture mail', 'fixture wiki', 'fixture note'],
  ]);
  expect(
    document.querySelector('[data-passwords-import-duplicate-check]')
  ).toBeNull();
});

it('starts over when the folder a continued import used is gone', async () => {
  const folder = { id: 'chosen-folder', name: 'Chosen', parentId: null };
  const source = createFakePasswordSource([], { busy: new Map([['bw-3', 3]]) });
  const resume = createMemoryImportResume();
  chooseFileOnClick(new File(['{}'], 'export.json'));
  mount(source, PARSED, resume, { items: [], folders: [folder] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Bitwarden JSON');
  // Into the existing folder.
  const change = screen.getByRole('button', { name: 'Change' });
  change.focus();
  fireEvent.keyDown(change, { key: 'Enter' });
  const chosen = await screen.findByRole('menuitem', { name: 'Chosen' });
  chosen.focus();
  fireEvent.keyDown(chosen, { key: 'Enter' });
  await waitFor(() =>
    expect(
      document.querySelector('[data-passwords-import-target]')?.textContent
    ).toBe('Chosen')
  );
  fireEvent.click(screen.getByText('Import 3 items'));
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  cleanup();

  // The folder was deleted since.
  mount(source, PARSED, resume, { items: [], folders: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText(
    'The folder an earlier import of this file used is gone, so this is a new import.'
  );
  expect(screen.queryByText(/^Continuing an earlier import/)).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
  expect(screen.getByText(/^New folder “Imported from Bitwarden/)).toBeTruthy();
});

const totpItem = (sourceKey: string, name: string) => ({
  sourceKey,
  name,
  kind: 'login' as const,
  url: null,
  folderKey: null,
  favorite: false,
  values: { username: 'fake', password: 'fake', notes: '', fields: [] },
  totp: 'JBSWY3DPEHPK3PXP',
});

it('keeps only the items still unfinished in what it stores for a rerun', async () => {
  const resume = createMemoryImportResume();
  const source = createFakePasswordSource([], {
    // A's code fails in every round; B's works.
    totpFailures: new Map([['a', 3]]),
  });
  const twoCodes: ParsedImport = {
    ...EXPORT,
    items: [totpItem('a', 'Code A'), totpItem('b', 'Code B')],
    skipped: [],
    dropped: [],
  };
  mount(
    source,
    { outcome: 'parsed', export: twoCodes, fileHash: 'c'.repeat(64) },
    resume,
    { items: [] }
  );
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import 2 items' })
  );
  await screen.findByText('1 failed', undefined, { timeout: 5000 });

  expect(resume.stored().map((entry) => Object.keys(entry.unfinished))).toEqual(
    [['a']]
  );
});

it('resends a code item whose answer was lost, though the vault has it', async () => {
  const resume = createMemoryImportResume();
  // The item is created, every answer to it is lost, then the vault answers.
  const source = createFakePasswordSource([], {
    loseResponses: 3,
    totpFailures: new Map([['a', 3]]),
  });
  const oneCode: ParsedImport = {
    ...EXPORT,
    items: [totpItem('a', 'Code A')],
    skipped: [],
    dropped: [],
  };
  const reply = {
    outcome: 'parsed',
    export: oneCode,
    fileHash: 'd'.repeat(64),
  } as const;
  mount(source, reply, resume, { items: [] });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 1 item' }));
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  expect((await source.list())[0]?.hasTotp).toBe(false);
  cleanup();

  // The vault lists the item now: a duplicate, but one this import never finished.
  mount(source, reply, resume, { items: await source.list() });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText(/^Continuing an earlier import of this file/);
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 item' }));
  await screen.findByText('1 already present');
  expect((await source.list())[0]?.hasTotp).toBe(true);
});

it('returns to the file picker when the file cannot be read at all', async () => {
  render(() => (
    <PasswordsProvider
      value={{
        scope: FIXTURE_SCOPE,
        source: createFakePasswordSource(),
        recipients: () => [],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async () => {},
        // As when the parser module fails to load.
        parseExport: () => Promise.reject(new Error('chunk load failed')),
        importResume: createMemoryImportResume(),
      }}
    >
      <ImportDialog
        items={() => []}
        folders={() => []}
        refresh={async () => {}}
        onOpenFolder={() => {}}
        onClose={() => {}}
      />
    </PasswordsProvider>
  ));
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText('The file could not be read. Try again.');
  expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
});

it('matches names in the vault while its list is unavailable', async () => {
  const matchRequests: string[][] = [];
  const source = createFakePasswordSource(
    [
      {
        item: EXISTING,
        values: { username: '', password: '', notes: '', fields: [] },
      },
    ],
    { matchRequests }
  );
  render(() => (
    <PasswordsProvider
      value={{
        scope: FIXTURE_SCOPE,
        source,
        recipients: () => [],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async () => {},
        parseExport: async () => PARSED,
        importResume: createMemoryImportResume(),
      }}
    >
      <ImportDialog
        items={() => undefined}
        folders={() => []}
        refresh={async () => {}}
        onOpenFolder={() => {}}
        onClose={() => {}}
      />
    </PasswordsProvider>
  ));
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText('1 item looks like one you already have.');
  expect(matchRequests).toHaveLength(1);
});

it('says duplicates went unchecked when the vault could not be asked', async () => {
  const source = createFakePasswordSource([], { failMatches: true });
  render(() => (
    <PasswordsProvider
      value={{
        scope: FIXTURE_SCOPE,
        source,
        recipients: () => [],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async () => {},
        parseExport: async () => PARSED,
        importResume: createMemoryImportResume(),
      }}
    >
      <ImportDialog
        items={() => undefined}
        folders={() => []}
        refresh={async () => {}}
        onOpenFolder={() => {}}
        onClose={() => {}}
      />
    </PasswordsProvider>
  ));
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  await screen.findByText(
    "Couldn't check this vault for items you already have, so copies may be imported."
  );
});

it('says nothing about duplicate checks for a small vault', async () => {
  mount(createFakePasswordSource(), PARSED);
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Bitwarden JSON');
  expect(
    document.querySelector('[data-passwords-import-duplicate-check]')
  ).toBeNull();
});

const vaultFolders = (count: number): Folder[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `vault-folder-${index}`,
    name: `Vault folder ${index}`,
    parentId: null,
  }));

it('counts only the folders the items being sent need', async () => {
  // Fixture Mail (in source folder Work) is already in the vault and skipped.
  const mail: PasswordItem = {
    ...EXISTING,
    name: 'Fixture Mail',
    url: 'https://mail.example.test',
  };
  mount(createFakePasswordSource(), PARSED, undefined, {
    items: [mail],
    // With Work and the new folder that would be 501; without Work, 500.
    folders: vaultFolders(499),
  });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));

  const start = await screen.findByRole('button', { name: 'Import 2 items' });
  expect((start as HTMLButtonElement).disabled).toBe(false);
});

it('leaves the folder cap to the vault when continuing an import', async () => {
  const source = createFakePasswordSource([], { busy: new Map([['bw-3', 3]]) });
  const resume = createMemoryImportResume();
  chooseFileOnClick(new File(['{}'], 'export.json'));
  mount(source, PARSED, resume, { items: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import 3 items' })
  );
  await screen.findByText('1 failed', undefined, { timeout: 5000 });
  cleanup();

  // The first run's folders count toward 500 already; they are not added twice.
  mount(source, PARSED, resume, { items: [], folders: vaultFolders(499) });
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText(/^Continuing an earlier import of this file/);
  const start = screen.getByRole('button', { name: 'Import 3 items' });
  expect((start as HTMLButtonElement).disabled).toBe(false);
});

it('says the server could not be reached when no batch got through', async () => {
  const source = createFakePasswordSource([], { failRequests: 9 });
  mount(source, PARSED, createMemoryImportResume());
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Bitwarden JSON');
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
  await screen.findByText('2 failed', undefined, { timeout: 5000 });
  expect(screen.getByText("Couldn't reach the server (2)")).toBeTruthy();
});

it('puts skipped file items and dropped attachments on one Not carried over line', async () => {
  mount(createFakePasswordSource(), {
    ...PARSED,
    export: {
      ...EXPORT,
      summary: {
        ...EXPORT.summary,
        skippedByReason: { trashed: 1, attachment: 1 },
        droppedByPart: { password_history: 2, attachment: 1 },
      },
    },
  });
  chooseFileOnClick(new File(['{}'], 'export.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  await screen.findByText('Not carried over');
  const lines = [
    ...document.querySelectorAll('[data-passwords-import-not-carried] li'),
  ].map((line) => line.textContent);
  expect(lines).toEqual([
    'Files and attachments2',
    'Items in the trash1',
    'Previous passwords2',
  ]);
  expect(screen.queryByText('Not imported')).toBeNull();
});
