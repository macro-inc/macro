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
const post = (body: unknown, headers: Record<string, string> = {}) =>
  canvas.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    {
      SYNC_WS_BASE: 'wss://sync.test',
      ANTHROPIC_API_KEY: 'test',
      CEREBRAS_API_KEY: 'test',
      OPENAI_API_KEY: 'test',
      INTERNAL_API_KEY: 'internal-key',
    }
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

  it('admits embeds only from internal callers holding an edit token', async () => {
    const embed = {
      documentId: '019fd3b9-3c6c-7c05-89c2-a27f0121813b',
      documentToken: token('edit'),
      request: {
        action: 'embed',
        itemId: '0193f3a4-7d1e-7c2a-9f00-0000000001e7',
        documentId: 'artifact-1',
        name: 'Onboarding',
        fileType: 'artifact',
        x: 0,
        y: 0,
        width: 640,
        height: 480,
        mentionId: '0193f3a4-7d1e-7c2a-9f00-00000000ae17',
      },
    };
    expect((await post(embed)).status).toBe(401);
    expect(
      (await post(embed, { 'x-internal-auth-key': 'wrong-key' })).status
    ).toBe(401);
    expect(
      (
        await post(
          { ...embed, documentToken: token('view') },
          { 'x-internal-auth-key': 'internal-key' }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await post(
          { ...embed, request: { ...embed.request, kind: 'embedDocument' } },
          { 'x-internal-auth-key': 'internal-key' }
        )
      ).status
    ).toBe(400);
    expect(state.session).not.toHaveBeenCalled();
    expect(state.source).not.toHaveBeenCalled();
  });
});
