import { describe, expect, it } from 'vitest';
import { chatBlockData } from './chatBlockData';

describe('chatBlockData', () => {
  it('initializes without a circular block-registry dependency', () => {
    expect(chatBlockData).toBeTypeOf('function');
  });
});
