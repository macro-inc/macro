import { createAIProjection } from '@queries/ai/projection';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from '../tests/fixtures';
import { createSuggestedReplies } from './suggested-replies';

vi.mock('@queries/ai/projection', () => ({ createAIProjection: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('suggested reply query', () => {
  it('generates only for messages received from outside the user inboxes', () =>
    createRoot((dispose) => {
      const latestMessage = message('latest', {
        from: { email: 'sender@example.com' },
        thread_db_id: 'thread-123',
      });
      vi.mocked(createAIProjection).mockReturnValue({
        data: () => ({ replies: [] }),
        isGenerating: () => false,
        error: () => undefined,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof createAIProjection>);

      createSuggestedReplies({
        threadId: () => 'thread-123',
        latestMessage: () => latestMessage,
        viewerEmails: () => ['viewer@example.com'],
        enabled: () => true,
        hasProfessionalFeatures: () => true,
      });

      const fastOptions = vi.mocked(createAIProjection).mock.calls[0][0];
      const smartOptions = vi.mocked(createAIProjection).mock.calls[1][0];
      expect(fastOptions().enabled).toBe(true);
      expect(smartOptions().enabled).toBe(true);
      expect(fastOptions().prompt).toContain('"thread-123"');
      expect(fastOptions().prompt).toContain('"latest"');

      latestMessage.from = { email: 'viewer@example.com' };
      expect(fastOptions().enabled).toBe(false);
      expect(smartOptions().enabled).toBe(false);
      dispose();
    }));

  it('prefers the smart result after initially showing the fast result', () =>
    createRoot((dispose) => {
      const projection = (body: string) =>
        ({
          data: () => ({ replies: [{ label: 'Reply', body }] }),
          isGenerating: () => false,
          error: () => undefined,
          refresh: vi.fn(),
        }) as unknown as ReturnType<typeof createAIProjection>;
      vi.mocked(createAIProjection)
        .mockReturnValueOnce(projection('Fast reply'))
        .mockReturnValueOnce(projection('Smart reply'));

      const suggestions = createSuggestedReplies({
        threadId: () => 'thread-123',
        latestMessage: () =>
          message('latest', { from: { email: 'sender@example.com' } }),
        viewerEmails: () => ['viewer@example.com'],
        enabled: () => true,
        hasProfessionalFeatures: () => true,
      });

      expect(suggestions.replies()).toEqual([
        { label: 'Reply', body: 'Smart reply' },
      ]);
      dispose();
    }));

  it('keeps loading when fast returns no replies while smart is still running', () =>
    createRoot((dispose) => {
      const [smartGenerating, setSmartGenerating] = createSignal(true);
      const projection = (
        data: { replies: [] } | undefined,
        isGenerating: () => boolean
      ) =>
        ({
          data: () => data,
          isGenerating,
          error: () => undefined,
          refresh: vi.fn(),
        }) as unknown as ReturnType<typeof createAIProjection>;
      vi.mocked(createAIProjection)
        .mockReturnValueOnce(projection({ replies: [] }, () => false))
        .mockReturnValueOnce(projection(undefined, smartGenerating));

      const suggestions = createSuggestedReplies({
        threadId: () => 'thread-123',
        latestMessage: () =>
          message('latest', { from: { email: 'sender@example.com' } }),
        viewerEmails: () => ['viewer@example.com'],
        enabled: () => true,
        hasProfessionalFeatures: () => true,
      });

      expect(suggestions.replies()).toEqual([]);
      expect(suggestions.isGenerating()).toBe(true);
      setSmartGenerating(false);
      expect(suggestions.isGenerating()).toBe(false);
      dispose();
    }));

  it('keeps a useful fast reply when the smart result is empty', () =>
    createRoot((dispose) => {
      const projection = (replies: { label: string; body: string }[]) =>
        ({
          data: () => ({ replies }),
          isGenerating: () => false,
          error: () => undefined,
          refresh: vi.fn(),
        }) as unknown as ReturnType<typeof createAIProjection>;
      vi.mocked(createAIProjection)
        .mockReturnValueOnce(
          projection([{ label: 'Reply', body: 'Fast reply' }])
        )
        .mockReturnValueOnce(projection([]));

      const suggestions = createSuggestedReplies({
        threadId: () => 'thread-123',
        latestMessage: () =>
          message('latest', { from: { email: 'sender@example.com' } }),
        viewerEmails: () => ['viewer@example.com'],
        enabled: () => true,
        hasProfessionalFeatures: () => true,
      });

      expect(suggestions.replies()).toEqual([
        { label: 'Reply', body: 'Fast reply' },
      ]);
      dispose();
    }));
});
