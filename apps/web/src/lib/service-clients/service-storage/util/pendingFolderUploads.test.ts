import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock('./upload', () => ({ resumePendingFolderUploads: mocks.resume }));

import {
  forgetPendingFolderUpload,
  PENDING_FOLDER_UPLOAD_MAX_AGE_MS,
  readPendingFolderUploads,
  rememberPendingFolderUpload,
  useResumeFolderUploads,
} from './pendingFolderUploads';

const NOW = 1_800_000_000_000;
const USER = 'macro|a@example.com';
const OTHER_USER = 'macro|b@example.com';

/** What the browser fires in this tab when another tab writes storage. */
function storageChangedInAnotherTab(userId: string) {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: `folder-uploads:pending:v1:${encodeURIComponent(userId)}`,
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.resume.mockReset();
  mocks.resume.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pending folder uploads', () => {
  it('keeps each account to its own folders', () => {
    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'Records',
      sentAt: NOW,
    });

    expect(readPendingFolderUploads(USER)).toEqual([
      { requestId: 'r1', name: 'Records', sentAt: NOW },
    ]);
    expect(readPendingFolderUploads('macro|b@example.com')).toEqual([]);
  });

  it('keeps folders other tabs sent while forgetting one', () => {
    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });
    rememberPendingFolderUpload(USER, {
      requestId: 'r2',
      name: 'B',
      sentAt: NOW,
    });
    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });

    forgetPendingFolderUpload(USER, 'r1');

    expect(readPendingFolderUploads(USER)).toEqual([
      { requestId: 'r2', name: 'B', sentAt: NOW },
    ]);
  });

  it('hides folders sent more than a day ago and deletes them on the next write', () => {
    const old = NOW - PENDING_FOLDER_UPLOAD_MAX_AGE_MS - 1;
    rememberPendingFolderUpload(USER, {
      requestId: 'old',
      name: 'A',
      sentAt: old,
    });

    expect(readPendingFolderUploads(USER)).toEqual([]);

    forgetPendingFolderUpload(USER, 'other');
    expect(readPendingFolderUploads(USER, old)).toEqual([]);
  });

  it('treats unreadable storage as nothing pending', () => {
    localStorage.setItem(
      `folder-uploads:pending:v1:${encodeURIComponent(USER)}`,
      '{not json'
    );

    expect(readPendingFolderUploads(USER)).toEqual([]);
  });
});

describe('useResumeFolderUploads', () => {
  function mountWith(initial: string | undefined) {
    const [userId, setUserId] = createSignal(initial);
    const dispose = createRoot((dispose) => {
      useResumeFolderUploads(userId);
      return dispose;
    });
    return { setUserId, dispose };
  }

  it('follows pending folders once the account is known', async () => {
    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });
    const { setUserId, dispose } = mountWith(undefined);
    await vi.dynamicImportSettled();
    expect(mocks.resume).not.toHaveBeenCalled();

    setUserId(USER);
    await vi.dynamicImportSettled();

    expect(mocks.resume).toHaveBeenCalledWith(USER);
    dispose();
  });

  it('starts nothing when the account has nothing pending', async () => {
    rememberPendingFolderUpload(OTHER_USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });
    const { dispose } = mountWith(USER);
    await vi.dynamicImportSettled();

    expect(mocks.resume).not.toHaveBeenCalled();
    dispose();
  });

  it('follows a folder another tab sends while this tab is open', async () => {
    const { dispose } = mountWith(USER);
    await vi.dynamicImportSettled();
    expect(mocks.resume).not.toHaveBeenCalled();

    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });
    storageChangedInAnotherTab(USER);
    await vi.dynamicImportSettled();

    expect(mocks.resume).toHaveBeenCalledWith(USER);
    dispose();
  });

  it('re-reads pending folders when another tab clears storage', async () => {
    const { dispose } = mountWith(USER);
    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });

    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    await vi.dynamicImportSettled();

    expect(mocks.resume).toHaveBeenCalledWith(USER);
    dispose();
  });

  it('listens only for the signed-in account while mounted', async () => {
    const { setUserId, dispose } = mountWith(USER);
    rememberPendingFolderUpload(USER, {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });
    rememberPendingFolderUpload(OTHER_USER, {
      requestId: 'r2',
      name: 'B',
      sentAt: NOW,
    });

    storageChangedInAnotherTab(OTHER_USER);
    await vi.dynamicImportSettled();
    expect(mocks.resume).not.toHaveBeenCalled();

    setUserId(OTHER_USER);
    await vi.dynamicImportSettled();
    mocks.resume.mockClear();
    storageChangedInAnotherTab(USER);
    dispose();
    storageChangedInAnotherTab(OTHER_USER);
    await vi.dynamicImportSettled();

    expect(mocks.resume).not.toHaveBeenCalled();
  });
});
