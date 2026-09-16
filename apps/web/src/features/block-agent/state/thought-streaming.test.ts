import { describe, expect, it } from 'vitest';
import { thoughtIsStreaming } from './thought-streaming';

describe('thoughtIsStreaming', () => {
  it('is true only for the last part of an open turn', () => {
    expect(thoughtIsStreaming(true, 2, 3)).toBe(true);
    expect(thoughtIsStreaming(true, 0, 1)).toBe(true);
  });

  it('settles earlier thoughts while the turn is still running', () => {
    expect(thoughtIsStreaming(true, 0, 3)).toBe(false);
    expect(thoughtIsStreaming(true, 1, 3)).toBe(false);
  });

  it('settles every thought once the turn has a stop reason', () => {
    expect(thoughtIsStreaming(false, 0, 1)).toBe(false);
    expect(thoughtIsStreaming(false, 2, 3)).toBe(false);
  });

  it('is false for an empty parts list', () => {
    expect(thoughtIsStreaming(true, 0, 0)).toBe(false);
  });
});
