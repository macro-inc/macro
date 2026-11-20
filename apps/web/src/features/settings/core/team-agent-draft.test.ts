import { describe, expect, it } from 'vitest';
import { addBlocker, teamAgentRequest } from './team-agent-draft';

describe('team agent draft', () => {
  it('sends the trimmed name and size, with the role left to the agent', () => {
    expect(
      teamAgentRequest({
        name: '  Ada ',
        size: 'large',
        purchaseKey: 'purchase-1',
      })
    ).toEqual({
      name: 'Ada',
      jobDescription: '',
      personality: '',
      size: 'large',
      avatarUrl: null,
      purchaseKey: 'purchase-1',
    });
  });

  it('asks for a name first, then a shorter one, then a size', () => {
    expect(
      addBlocker({ name: '  ', size: undefined, purchaseKey: 'purchase-1' })
    ).toBe('name');
    expect(
      addBlocker({
        name: 'a'.repeat(65),
        size: 'standard',
        purchaseKey: 'purchase-1',
      })
    ).toBe('name_too_long');
    expect(
      addBlocker({ name: 'Ada', size: undefined, purchaseKey: 'purchase-1' })
    ).toBe('size');
    expect(
      teamAgentRequest({ name: 'Ada', size: undefined, purchaseKey: 'p' })
    ).toBeUndefined();
  });

  it('counts characters, not UTF-16 units, against the name limit', () => {
    expect(
      addBlocker({
        name: '🤖'.repeat(64),
        size: 'standard',
        purchaseKey: 'purchase-1',
      })
    ).toBeUndefined();
  });
});
