import { describe, expect, it } from 'vitest';
import { type MessageId, withAuthor } from './message-id';

describe('withAuthor', () => {
  it('addresses the other side of the turn without changing the turn', () => {
    const prompt: MessageId = { turn: 4, author: 'user' };

    expect(withAuthor(prompt, 'agent')).toEqual({ turn: 4, author: 'agent' });
  });

  it('leaves the original untouched', () => {
    const prompt: MessageId = { turn: 4, author: 'user' };

    withAuthor(prompt, 'agent');

    expect(prompt).toEqual({ turn: 4, author: 'user' });
  });
});
