import { describe, expect, it } from 'vitest';
import {
  buildSuggestedRepliesPrompt,
  suggestedRepliesSchema,
} from './suggested-replies';

describe('suggested replies', () => {
  it('grounds generation in the exact thread and latest message', () => {
    const prompt = buildSuggestedRepliesPrompt('thread-123', 'message-456');

    expect(prompt).toContain('GetThread');
    expect(prompt).toContain('"thread-123"');
    expect(prompt).toContain('"message-456"');
    expect(prompt).toContain('Never invent');
  });

  it('accepts at most three labeled plain-text replies', () => {
    expect(
      suggestedRepliesSchema.safeParse({
        replies: [
          { label: 'Confirm', body: 'That works for me.' },
          {
            label: 'Ask for timing',
            body: 'What timing did you have in mind?',
          },
          { label: 'Decline', body: "I can't make that work this week." },
        ],
      }).success
    ).toBe(true);

    expect(
      suggestedRepliesSchema.safeParse({
        replies: Array.from({ length: 4 }, (_, index) => ({
          label: `Reply ${index}`,
          body: 'Body',
        })),
      }).success
    ).toBe(false);
  });
});
