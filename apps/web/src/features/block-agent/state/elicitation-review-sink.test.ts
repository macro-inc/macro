import { describe, expect, it, vi } from 'vitest';
import { createElicitationReviewSink } from './elicitation-review-sink';

describe('MCP composer answers', () => {
  it('declares encoded email bodies only when the form supports that field', async () => {
    for (const encodedEmailBody of [false, true]) {
      const respond = vi.fn().mockResolvedValue(true);
      const sink = createElicitationReviewSink({
        encodedEmailBody,
        canAnswer: () => true,
        ownerName: () => 'Alice',
        answering: () => false,
        respond,
      });
      await sink.onExecute({ body: 'PHA-SGVsbG88L3A-' });
      expect(respond).toHaveBeenCalledWith({
        action: 'accept',
        content: {
          draft: JSON.stringify({ body: 'PHA-SGVsbG88L3A-' }),
          ...(encodedEmailBody ? { bodyFormat: 'base64url_html' } : {}),
        },
      });
    }
  });
});
