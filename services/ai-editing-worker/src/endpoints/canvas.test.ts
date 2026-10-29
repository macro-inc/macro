import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  edit: vi.fn(),
  session: vi.fn(),
  source: vi.fn(),
}));
vi.mock('../canvas/direct', () => ({ applyCanvasCode: vi.fn() }));
vi.mock('../canvas/agent', () => ({ editCanvas: state.edit }));
vi.mock('../canvas/session', () => ({ withCanvasSession: state.session }));
vi.mock('../sources', () => ({ createWorkerSyncSource: state.source }));
vi.mock('./edit', () => ({ buildModels: vi.fn() }));
const { default: canvas } = await import('./canvas');

const token = (access_level: string) =>
  ['header', btoa(JSON.stringify({ access_level })), 'signature'].join('.');
const post = (body: unknown) =>
  canvas.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { SYNC_WS_BASE: 'wss://sync.test' }
  );

describe('POST /canvas request admission', () => {
  it('refuses view/comment/malformed tokens before opening a session or starting a model', async () => {
    for (const documentToken of [
      token('view'),
      token('comment'),
      'bad-token',
    ]) {
      const response = await post({
        documentId: '019fd3b9-3c6c-7c05-89c2-a27f0121813b',
        documentToken,
        request: {
          action: 'apply',
          expectedRevision: 'a'.repeat(64),
          code: 'editor.delete(["box"])',
        },
      });
      expect(response.status).toBe(403);
    }
    expect(state.edit).not.toHaveBeenCalled();
    expect(state.session).not.toHaveBeenCalled();
    expect(state.source).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs, oversized instructions and unknown action fields', async () => {
    for (const body of [
      {
        documentId: 'wrong',
        documentToken: token('edit'),
        request: { action: 'read' },
      },
      {
        documentId: '019fd3b9-3c6c-7c05-89c2-a27f0121813b',
        documentToken: token('edit'),
        request: { action: 'edit', instructions: 'x'.repeat(20001) },
      },
      {
        documentId: '019fd3b9-3c6c-7c05-89c2-a27f0121813b',
        documentToken: token('edit'),
        request: { action: 'read', code: 'arbitrary' },
      },
    ])
      expect((await post(body)).status).toBe(400);
    expect(state.edit).not.toHaveBeenCalled();
    expect(state.source).not.toHaveBeenCalled();
  });
});
