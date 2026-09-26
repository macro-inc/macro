import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { okAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  ingest: vi.fn(async () => true),
  load: vi.fn(async () => undefined),
  readWal: vi.fn(async () => []),
  cleanup: vi.fn(),
}));
vi.mock('@macro-inc/collaboration/collab/manager', () => ({
  createLoroManager: () => ({ ingest: doubles.ingest }),
}));
vi.mock('@macro-inc/collaboration/collab/snapshot-store', () => ({
  LORO_SNAPSHOT_DB_NAME: 'snapshots',
  IDBSnapshotStore: class {
    load = doubles.load;
  },
}));
vi.mock('@macro-inc/collaboration/collab/wal', () => ({
  LORO_WAL_DB_NAME: 'wal',
  BrowserWALStore: class {
    getAll = doubles.readWal;
  },
}));
vi.mock('@macro-inc/lexical-core/markdown-loro-schema', () => ({
  MARKDOWN_LORO_SCHEMA: {},
}));

import {
  createProjectDescriptionSession,
  type ProjectDescriptionTransport,
} from './project-description';

function transport(
  getToken: () => Promise<string>
): ProjectDescriptionTransport {
  return {
    getToken,
    connect: vi.fn(() => ({
      source: {
        ...createNoopLiveSyncSource('description'),
        cleanup: doubles.cleanup,
      },
      doInitialSync: () =>
        okAsync({ snapshot: new Uint8Array([1]), awareness: new Uint8Array() }),
    })),
  };
}

describe('project description sessions', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not read cached content or connect after authorization fails', async () => {
    const port = transport(async () => {
      throw new Error('Forbidden');
    });
    const { session, cleanup } = createRoot((cleanup) => ({
      cleanup,
      session: createProjectDescriptionSession('description', port),
    }));
    try {
      await session.loaded;
      expect(session.connectionError()).toBe('Forbidden');
      expect(doubles.load).not.toHaveBeenCalled();
      expect(port.connect).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      cleanup();
    }
  });

  it('does not open a socket if the view closes while permission is loading', async () => {
    let authorize!: (token: string) => void;
    const permission = new Promise<string>((resolve) => {
      authorize = resolve;
    });
    const port = transport(() => permission);
    const { session, cleanup } = createRoot((cleanup) => ({
      cleanup,
      session: createProjectDescriptionSession('description', port),
    }));
    session.dispose();
    authorize('token');
    try {
      await session.loaded;
      expect(port.connect).not.toHaveBeenCalled();
      expect(doubles.load).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('joins the existing document and closes its socket on disposal', async () => {
    const port = transport(async () => 'token');
    const { session, cleanup } = createRoot((cleanup) => ({
      cleanup,
      session: createProjectDescriptionSession('description', port),
    }));
    try {
      await session.loaded;
      expect(port.connect).toHaveBeenCalledWith('description', 'token');
      expect(doubles.ingest).toHaveBeenCalledWith({
        kind: 'dss',
        snapshot: new Uint8Array([1]),
      });
      session.dispose();
      expect(doubles.cleanup).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});
