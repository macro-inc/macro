import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  run: vi.fn(),
  urls: [] as string[],
}));

vi.mock('../document-ops/run', async (original) => ({
  ...(await original()),
  runDocumentOps: state.run,
}));
vi.mock('../sources', () => ({
  createWorkerSyncSource: (url: string) => {
    state.urls.push(url);
    return {};
  },
}));
vi.mock('../env', () => ({
  getEnv: () => ({ SYNC_WS_BASE: 'wss://sync.test' }),
}));

const { UnacknowledgedError } = await import('../document-ops/run');
const { default: documentOps } = await import('./document-ops');

const post = (body: unknown) =>
  documentOps.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** An unsigned token claiming `access_level`; the sync service checks signatures. */
const token = (access_level: string) =>
  [
    'header',
    btoa(JSON.stringify({ access_level })).replace(/=+$/, ''),
    'sig',
  ].join('.');

const setText = { kind: 'setText', node: 'p1', text: 'Hello' };

describe('POST /document-ops', () => {
  beforeEach(() => {
    state.run.mockReset();
    state.urls.length = 0;
  });

  it('applies the batch as the named editor', async () => {
    state.run.mockResolvedValue({
      applied: 1,
      changedBlockIds: ['p1'],
      revision: 'AQID',
    });
    const response = await post({
      documentId: 'doc',
      documentToken: token('edit'),
      operations: [setText],
      editor: { name: 'Macro' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applied: 1,
      changedBlockIds: ['p1'],
      revision: 'AQID',
    });
    expect(state.urls).toEqual([
      `wss://sync.test/document/doc/connect?token=${token('edit')}`,
    ]);
    expect(state.run).toHaveBeenCalledWith(
      expect.anything(),
      'doc',
      [setText],
      { name: 'Macro' }
    );
  });

  it('answers 422 with every failing op', async () => {
    state.run.mockResolvedValue({
      failures: [{ index: 0, kind: 'setText', message: 'unknown id "p1"' }],
    });
    const response = await post({
      documentId: 'doc',
      documentToken: token('owner'),
      operations: [setText],
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'edit_rejected',
      failures: [{ index: 0, kind: 'setText', message: 'unknown id "p1"' }],
    });
  });

  it('answers 502 when the sync service did not acknowledge the batch', async () => {
    state.run.mockRejectedValue(
      new UnacknowledgedError('sync service did not acknowledge 1 update(s)')
    );
    const response = await post({
      documentId: 'doc',
      documentToken: token('edit'),
      operations: [setText],
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'unacknowledged',
      message: 'sync service did not acknowledge 1 update(s)',
    });
  });

  it.each(['view', 'comment'])('refuses a %s token', async (level) => {
    const response = await post({
      documentId: 'doc',
      documentToken: token(level),
      operations: [setText],
    });
    expect(response.status).toBe(403);
    expect(state.run).not.toHaveBeenCalled();
  });

  it.each([
    ['no operations', []],
    ['more than 200 operations', Array.from({ length: 201 }, () => setText)],
    ['an operation without a kind', [{ node: 'p1', text: 'Hello' }]],
  ])('refuses a batch with %s', async (_, operations) => {
    const response = await post({
      documentId: 'doc',
      documentToken: token('edit'),
      operations,
    });
    expect(response.status).toBe(400);
    expect(state.run).not.toHaveBeenCalled();
  });
});
