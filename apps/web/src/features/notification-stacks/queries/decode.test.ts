import { describe, expect, it } from 'vitest';
import { rule } from '../tests/stacks';
import { toStack, toWireRule } from './decode';

describe('toStack', () => {
  it('reads a stack and fills the conditions a rule leaves out', () => {
    const stack = toStack({
      id: 'stack-1',
      name: 'Support channels',
      position: 0,
      lane: 'noise',
      capture: [
        { sources: [{ type: 'channelNameContains', text: 'support' }] },
      ],
      release: [{ kinds: ['mention'] }],
      enabled: true,
      revision: 3,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    });

    expect(stack).toEqual({
      id: 'stack-1',
      name: 'Support channels',
      capture: [
        rule({ sources: [{ type: 'channelNameContains', text: 'support' }] }),
      ],
      release: [rule({ kinds: ['mention'] })],
      enabled: true,
    });
  });
});

describe('toWireRule', () => {
  it('writes every condition of a rule', () => {
    expect(
      toWireRule(
        rule({
          sources: [{ type: 'channel', id: 'channel-1' }],
          senders: ['macro|sam@example.com'],
        })
      )
    ).toEqual({
      sources: [{ type: 'channel', id: 'channel-1' }],
      channelTypes: [],
      kinds: [],
      senders: ['macro|sam@example.com'],
    });
  });
});
