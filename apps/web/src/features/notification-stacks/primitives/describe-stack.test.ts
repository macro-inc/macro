import { describe, expect, it } from 'vitest';
import { rule, supportStack } from '../tests/stacks';
import { describeStack } from './describe-stack';

describe('describeStack', () => {
  it('says where a stack captures from and what it lets through', () => {
    expect(describeStack(supportStack())).toBe(
      'Channels named “support” · Lets Mentions through'
    );
  });

  it('counts the places and people, and names the kinds', () => {
    const stack = supportStack({
      capture: [
        rule({
          sources: [
            { type: 'channel', id: 'one' },
            { type: 'channel', id: 'two' },
            { type: 'folder', id: 'folder' },
          ],
          senders: ['macro|sam@example.com'],
          kinds: ['newMessage', 'reaction'],
        }),
      ],
      release: [rule({ kinds: ['mention'] }), rule({ kinds: ['reply'] })],
    });
    expect(describeStack(stack)).toBe(
      '2 channels, 1 folder, and From 1 person · New messages and Reactions · Lets Mentions and Replies through'
    );
  });

  it('says a stack with only kinds captures everywhere', () => {
    const stack = supportStack({
      capture: [rule({ kinds: ['reaction'] })],
      release: [],
    });
    expect(describeStack(stack)).toBe('Everywhere · Reactions');
  });

  it('does not guess at rules the editor cannot show', () => {
    const stack = supportStack({
      capture: [rule({ kinds: ['reaction'] }), rule({ kinds: ['comment'] })],
    });
    expect(describeStack(stack)).toBe('Custom rules');
  });
});
