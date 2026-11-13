import LIMITS from '@core/password-import/limits.json';
import type {
  ParsedImportFolder,
  ParsedImportItem,
} from '@core/password-import/types';
import { NOOP_SPAN } from '@macro-inc/observability';
import { describe, expect, it } from 'vitest';
import type { ImportBatchBody } from '../context/passwords-context';
import {
  BATCH_BYTES,
  BATCH_ITEMS,
  checkFolders,
  duplicateKeys,
  foldersFor,
  MAX_FOLDER_DEPTH,
  MAX_TEAM_FOLDERS,
  planBatches,
  uniqueRootFolderName,
} from '../core/import';
import type { PasswordItem } from '../core/types';
import { sendImport } from '../primitives/import';
import { createFakePasswordSource } from './fake-source';

function item(
  sourceKey: string,
  overrides: Partial<ParsedImportItem> = {}
): ParsedImportItem {
  return {
    sourceKey,
    name: `Item ${sourceKey}`,
    kind: 'login',
    url: null,
    folderKey: null,
    favorite: false,
    values: {
      username: 'fake-user',
      password: 'fake-pass',
      notes: '',
      fields: [],
    },
    totp: null,
    ...overrides,
  };
}

const FOLDERS: ParsedImportFolder[] = [
  { key: 'folder:0', name: 'Work', parentKey: null, path: ['Work'] },
  {
    key: 'folder:1',
    name: 'Servers',
    parentKey: 'folder:0',
    path: ['Work', 'Servers'],
  },
  { key: 'folder:2', name: 'Home', parentKey: null, path: ['Home'] },
];

const IMPORT_ID = '019a7000-0000-7000-8000-000000000001';

function vaultItem(overrides: Partial<PasswordItem>): PasswordItem {
  return {
    id: crypto.randomUUID(),
    teamId: 'fixture-team',
    name: 'Existing',
    kind: 'login',
    url: null,
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
    ...overrides,
  };
}

describe('planBatches', () => {
  it('splits at 25 items', () => {
    const items = Array.from({ length: 60 }, (_, index) =>
      item(`row:${index + 1}`)
    );
    expect(planBatches(items, []).map((batch) => batch.length)).toEqual([
      25, 25, 10,
    ]);
  });

  it('splits by serialized size before the item limit, keeping order', () => {
    const notes = 'n'.repeat(1000);
    const items = Array.from({ length: 10 }, (_, index) =>
      item(`row:${index + 1}`, {
        values: { username: '', password: '', notes, fields: [] },
      })
    );
    const batches = planBatches(items, [], { maxItems: 25, maxBytes: 3500 });
    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 2, 2, 2]);
    expect(batches.flat().map((entry) => entry.sourceKey)).toEqual(
      items.map((entry) => entry.sourceKey)
    );
  });

  it('sends an item larger than the limit on its own', () => {
    const big = item('row:2', {
      values: {
        username: '',
        password: '',
        notes: 'x'.repeat(5000),
        fields: [],
      },
    });
    const batches = planBatches([item('row:1'), big, item('row:3')], [], {
      maxItems: 25,
      maxBytes: 3000,
    });
    expect(
      batches.map((batch) => batch.map((entry) => entry.sourceKey))
    ).toEqual([['row:1'], ['row:2'], ['row:3']]);
  });
});

describe('foldersFor', () => {
  it('sends referenced folders and their ancestors, parents first', () => {
    expect(
      foldersFor([item('a', { folderKey: 'folder:1' })], FOLDERS).map(
        (folder) => folder.key
      )
    ).toEqual(['folder:0', 'folder:1']);
    expect(foldersFor([item('a')], FOLDERS)).toEqual([]);
  });
});

describe('duplicateKeys', () => {
  it('matches kind, name ignoring case and spaces, and website host', () => {
    const existing = [
      vaultItem({ name: 'GitHub', url: 'https://github.com/login' }),
      vaultItem({ name: 'Bank', kind: 'card' }),
    ];
    const keys = duplicateKeys(
      [
        item('same', { name: ' github ', url: 'https://www.github.com/' }),
        item('other-host', { name: 'GitHub', url: 'https://gitlab.com' }),
        item('other-kind', { name: 'Bank' }),
        item('card', { name: 'Bank', kind: 'card' }),
      ],
      existing
    );
    expect([...keys].sort()).toEqual(['card', 'same']);
  });
});

describe('limits', () => {
  it('match the vault limits the Rust crates check', () => {
    expect(MAX_TEAM_FOLDERS).toBe(LIMITS.maxTeamFolders);
    expect(MAX_FOLDER_DEPTH).toBe(LIMITS.maxFolderDepth);
    expect(BATCH_ITEMS).toBe(LIMITS.maxImportBatchItems);
    // A budget under the body limit leaves room for the folder tree and JSON.
    expect(BATCH_BYTES).toBeLessThan(LIMITS.maxImportBatchBytes);
  });
});

describe('uniqueRootFolderName', () => {
  it('numbers the name past root folders that already use it, ignoring case', () => {
    const numbered = (number: number) => `Imported (${number})`;
    const folders = [
      { id: 'a', name: 'imported', parentId: null },
      { id: 'b', name: 'Imported (2)', parentId: null },
      { id: 'c', name: 'Imported (3)', parentId: 'a' },
    ];

    expect(uniqueRootFolderName('Imported', [], numbered)).toBe('Imported');
    expect(uniqueRootFolderName('Imported', folders, numbered)).toBe(
      'Imported (3)'
    );
  });
});

describe('checkFolders', () => {
  it('counts the new target folder and the source depth under it', () => {
    const deep: ParsedImportFolder[] = [
      {
        key: 'folder:0',
        name: 'h',
        parentKey: null,
        path: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      },
    ];
    expect(checkFolders({ kind: 'root' }, deep, [])).toMatchObject({
      depth: 8,
      tooDeep: false,
    });
    expect(
      checkFolders({ kind: 'new', name: 'Imported' }, deep, [])
    ).toMatchObject({
      depth: 9,
      tooDeep: true,
      total: 2,
    });
  });

  it('refuses an import past 500 folders', () => {
    const vault = Array.from({ length: 498 }, (_, index) => ({
      id: `f${index}`,
      name: `F${index}`,
      parentId: null,
    }));
    expect(
      checkFolders({ kind: 'new', name: 'Imported' }, FOLDERS, vault)
    ).toMatchObject({
      total: 502,
      tooMany: true,
    });
    expect(
      checkFolders(
        { kind: 'existing', folderId: 'f1' },
        FOLDERS.slice(0, 2),
        vault
      ).tooMany
    ).toBe(false);
  });
});

describe('sendImport', () => {
  const noWait = async () => {};

  it('sends one batch at a time and reuses the target folder after the first', async () => {
    const requests: ImportBatchBody[] = [];
    const source = createFakePasswordSource([], { requests });
    const items = Array.from({ length: 30 }, (_, index) =>
      item(`row:${index + 1}`, { folderKey: index === 0 ? 'folder:1' : null })
    );
    const progress: number[] = [];
    const outcome = await sendImport(
      source,
      {
        importId: IMPORT_ID,
        format: 'bitwarden_json',
        target: { kind: 'new', name: 'Imported from Bitwarden' },
        private: false,
        items,
        folders: FOLDERS,
      },
      {
        span: NOOP_SPAN,
        onProgress: (done) => progress.push(done),
        wait: noWait,
      }
    );
    expect(outcome).toMatchObject({
      created: 30,
      alreadyPresent: 0,
      failed: 0,
    });
    expect(requests.map((request) => request.items.length)).toEqual([25, 5]);
    expect(requests[0]?.target.kind).toBe('new');
    expect(requests[0]?.folders.map((folder) => folder.key)).toEqual([
      'folder:0',
      'folder:1',
    ]);
    expect(requests[1]?.target).toEqual({
      kind: 'existing',
      folderId: outcome.targetFolderId,
    });
    expect(requests[1]?.folders).toEqual([]);
    expect(progress).toEqual([25, 30]);
  });

  it('resends only the items the vault answered busy for', async () => {
    const requests: ImportBatchBody[] = [];
    const waits: number[] = [];
    const source = createFakePasswordSource([], {
      requests,
      busy: new Map([['row:2', 1]]),
    });
    const outcome = await sendImport(
      source,
      {
        importId: IMPORT_ID,
        format: 'bitwarden_csv',
        target: { kind: 'root' },
        private: true,
        items: [item('row:1'), item('row:2'), item('row:3')],
        folders: [],
      },
      {
        span: NOOP_SPAN,
        onProgress: () => {},
        wait: async (ms) => {
          waits.push(ms);
        },
      }
    );
    expect(outcome).toMatchObject({ created: 3, failed: 0 });
    expect(
      requests.map((request) => request.items.map((entry) => entry.sourceKey))
    ).toEqual([['row:1', 'row:2', 'row:3'], ['row:2']]);
    expect(waits).toHaveLength(1);
  });

  it('resends an item whose folder was deleted mid-import', async () => {
    const requests: ImportBatchBody[] = [];
    const source = createFakePasswordSource([], {
      requests,
      folderMissing: new Map([['row:1', 1]]),
    });
    const outcome = await sendImport(
      source,
      {
        importId: IMPORT_ID,
        format: 'bitwarden_csv',
        target: { kind: 'root' },
        private: true,
        items: [item('row:1')],
        folders: [],
      },
      { span: NOOP_SPAN, onProgress: () => {}, wait: noWait }
    );
    expect(outcome).toMatchObject({ created: 1, failed: 0 });
    expect(requests).toHaveLength(2);
  });

  it('gives up on an item that stays busy and counts it failed', async () => {
    const source = createFakePasswordSource([], {
      busy: new Map([['row:1', 10]]),
    });
    const outcome = await sendImport(
      source,
      {
        importId: IMPORT_ID,
        format: 'bitwarden_csv',
        target: { kind: 'root' },
        private: false,
        items: [item('row:1')],
        folders: [],
      },
      { span: NOOP_SPAN, onProgress: () => {}, wait: noWait }
    );
    expect(outcome).toMatchObject({ created: 0, failed: 1 });
  });

  it('retries a failed request, then fails its batch without stopping the rest', async () => {
    const requests: ImportBatchBody[] = [];
    const source = createFakePasswordSource([], { requests, failRequests: 3 });
    const items = Array.from({ length: 30 }, (_, index) =>
      item(`row:${index + 1}`)
    );
    const outcome = await sendImport(
      source,
      {
        importId: IMPORT_ID,
        format: 'one_password_csv',
        target: { kind: 'root' },
        private: false,
        items,
        folders: [],
      },
      { span: NOOP_SPAN, onProgress: () => {}, wait: noWait }
    );
    expect(requests).toHaveLength(4);
    expect(outcome).toMatchObject({
      created: 5,
      failed: 25,
      interrupted: true,
    });
  });

  it('sends a rejected batch once and goes on with the rest', async () => {
    const requests: ImportBatchBody[] = [];
    const source = createFakePasswordSource([], {
      requests,
      failRequests: 1,
      failWith: 'rejected',
    });
    const items = Array.from({ length: 30 }, (_, index) =>
      item(`row:${index + 1}`)
    );
    const outcome = await sendImport(
      source,
      {
        importId: IMPORT_ID,
        format: 'one_password_csv',
        target: { kind: 'root' },
        private: false,
        items,
        folders: [],
      },
      { span: NOOP_SPAN, onProgress: () => {}, wait: noWait }
    );
    expect(requests).toHaveLength(2);
    expect(outcome).toMatchObject({ created: 5, failed: 25 });
  });

  it('counts items a rerun of the same import already landed as already present', async () => {
    const source = createFakePasswordSource();
    const run = {
      importId: IMPORT_ID,
      format: 'one_password_pux' as const,
      target: { kind: 'root' as const },
      private: false,
      items: [item('a'), item('b')],
      folders: [],
    };
    const options = { span: NOOP_SPAN, onProgress: () => {}, wait: noWait };
    await sendImport(source, { ...run, items: [item('a')] }, options);
    expect(await sendImport(source, run, options)).toMatchObject({
      created: 1,
      alreadyPresent: 1,
    });
  });
});
