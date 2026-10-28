import { DocxAgentError } from '@macro-inc/collaboration/docx/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  run: vi.fn(),
  cleanup: vi.fn(),
  urls: [] as string[],
}));

vi.mock('@macro-inc/collaboration/docx/agent', async (original) => ({
  ...(await original()),
  runDocxAgentRequest: state.run,
}));
vi.mock('../sources', () => ({
  createWorkerSyncSource: (url: string) => {
    state.urls.push(url);
    return { cleanup: state.cleanup };
  },
}));
vi.mock('../env', () => ({
  getEnv: () => ({ SYNC_WS_BASE: 'wss://sync.test' }),
}));

const { default: docx } = await import('./docx');

const post = (body: unknown) =>
  docx.request('/', {
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

const body = (request: unknown, documentToken = token('edit')) => ({
  documentId: 'doc',
  documentToken,
  request,
});

describe('POST /docx', () => {
  beforeEach(() => {
    state.run.mockReset();
    state.cleanup.mockReset();
    state.urls.length = 0;
  });

  it('runs the request against the document session and closes it', async () => {
    state.run.mockResolvedValue({ content: 'Word document with 3 blocks.' });
    const response = await post(body({ action: 'read', start: null }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: 'Word document with 3 blocks.',
    });
    expect(state.urls).toEqual([
      `wss://sync.test/document/doc/connect?token=${token('edit')}`,
    ]);
    expect(state.run).toHaveBeenCalledWith(expect.anything(), {
      action: 'read',
      start: undefined,
      count: undefined,
    });
    expect(state.cleanup).toHaveBeenCalled();
  });

  it('accepts null optional fields the way serde sends them', async () => {
    state.run.mockResolvedValue({ content: 'ok' });
    const response = await post(
      body({
        action: 'edit',
        operations: [
          {
            type: 'insertParagraph',
            after: 'p1',
            before: null,
            text: 'New',
            style: null,
          },
        ],
      })
    );
    expect(response.status).toBe(200);
    expect(state.run.mock.calls[0][1].operations[0]).toEqual({
      type: 'insertParagraph',
      after: 'p1',
      before: undefined,
      text: 'New',
      style: undefined,
    });
  });

  it('passes tracking, the author and comments through', async () => {
    state.run.mockResolvedValue({ content: 'ok' });
    const response = await post(
      body({
        action: 'edit',
        operations: [
          { type: 'addComment', paragraph: 'p1', find: null, text: 'Why?' },
        ],
        trackChanges: true,
        author: ' Jacob Beckerman ',
      })
    );
    expect(response.status).toBe(200);
    expect(state.run.mock.calls[0][1]).toEqual({
      action: 'edit',
      operations: [
        {
          type: 'addComment',
          paragraph: 'p1',
          find: undefined,
          occurrence: undefined,
          text: 'Why?',
        },
      ],
      trackChanges: true,
      author: 'Jacob Beckerman',
    });
  });

  it('returns what the agent did wrong as a 422', async () => {
    state.run.mockRejectedValue(new DocxAgentError('No paragraph has id x.'));
    const response = await post(
      body({ action: 'edit', operations: [{ type: 'delete', id: 'x' }] })
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'No paragraph has id x.' });
    expect(state.cleanup).toHaveBeenCalled();
  });

  it('hides infrastructure failures behind a retry hint', async () => {
    state.run.mockRejectedValue(new Error('initial sync failed: timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await post(body({ action: 'read' }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/could not be reached/);
  });

  it('refuses edits without an edit token before connecting', async () => {
    for (const access of ['view', 'comment']) {
      const response = await post(
        body(
          { action: 'edit', operations: [{ type: 'delete', id: 'x' }] },
          token(access)
        )
      );
      expect(response.status).toBe(403);
    }
    const garbled = await post(
      body({ action: 'edit', operations: [{ type: 'delete', id: 'x' }] }, 'x')
    );
    expect(garbled.status).toBe(403);
    expect(state.urls).toHaveLength(0);
    // Reading needs no more than the view access the sync service checks.
    state.run.mockResolvedValue({ content: 'ok' });
    expect((await post(body({ action: 'read' }, token('view')))).status).toBe(
      200
    );
  });

  it('rejects malformed operations before connecting', async () => {
    const response = await post(
      body({ action: 'edit', operations: [{ type: 'explode' }] })
    );
    expect(response.status).toBe(400);
    expect(state.urls).toHaveLength(0);
  });
});
