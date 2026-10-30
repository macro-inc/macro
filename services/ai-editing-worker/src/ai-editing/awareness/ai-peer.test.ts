import { describe, expect, it } from 'vitest';
import { isAiPeer, nextAiPeerId } from './ai-peer';

describe('nextAiPeerId', () => {
  it('draws recognizable AI peers that are never reused', () => {
    const ids = Array.from({ length: 1000 }, nextAiPeerId);
    expect(ids.every(isAiPeer)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
