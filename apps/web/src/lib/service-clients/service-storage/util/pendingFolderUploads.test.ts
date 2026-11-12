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
    rememberPendingFolderUpload('macro|b@example.com', {
      requestId: 'r1',
      name: 'A',
      sentAt: NOW,
    });
    const { dispose } = mountWith(USER);
    await vi.dynamicImportSettled();

    expect(mocks.resume).not.toHaveBeenCalled();
    dispose();
  });
});
