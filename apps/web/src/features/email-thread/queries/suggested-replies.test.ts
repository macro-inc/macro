import { createAIProjection } from '@queries/ai/projection';
import { createRoot } from 'solid-js';
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
});
