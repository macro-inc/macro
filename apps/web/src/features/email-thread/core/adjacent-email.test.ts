import { describe, expect, it } from 'vitest';
import { adjacentEmail } from './adjacent-email';

const rows = [
  { id: 'a', type: 'email' },
  { id: 'channel', type: 'channel' },
  { id: 'b', type: 'email' },
  { id: 'b', type: 'email' },
  { id: 'c', type: 'email' },
];
describe('adjacent email navigation', () => {
  it('follows list order and skips non-email rows and duplicate notifications', () => {
    expect(adjacentEmail(rows, 'a', 1)?.id).toBe('b');
    expect(adjacentEmail(rows, 'b', 1)?.id).toBe('c');
    expect(adjacentEmail(rows, 'b', -1)?.id).toBe('a');
  });
  it('does not wrap at either end', () => {
    expect(adjacentEmail(rows, 'a', -1)).toBeUndefined();
    expect(adjacentEmail(rows, 'c', 1)).toBeUndefined();
  });
  it('does not jump to another email when the current thread is absent', () => {
    expect(adjacentEmail(rows, 'missing', 1)).toBeUndefined();
    expect(adjacentEmail([], 'a', -1)).toBeUndefined();
  });
});
