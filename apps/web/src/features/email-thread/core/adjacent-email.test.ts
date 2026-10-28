import { describe, expect, it } from 'vitest';
import { adjacentEmail, emailPosition } from './adjacent-email';

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
  it('steps from the former neighbours once the current thread leaves', () => {
    const former = emailPosition(rows, 'b');
    const remaining = rows.filter((row) => row.id !== 'b');
    expect(adjacentEmail(remaining, 'b', 1, former)?.id).toBe('c');
    expect(adjacentEmail(remaining, 'b', -1, former)?.id).toBe('a');
  });
  it('keeps its opened neighbours after the thread moves to the top', () => {
    const former = emailPosition(rows, 'b');
    // A reply draft lifts b above a.
    const moved = [rows[2], rows[0], rows[1], rows[4]];
    expect(adjacentEmail(moved, 'b', 1, former)?.id).toBe('c');
    expect(adjacentEmail(moved, 'b', -1, former)?.id).toBe('a');
  });
  it('skips former neighbours that left with it', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'email' }));
    const former = emailPosition(list, 'b');
    const remaining = list.filter((row) => row.id === 'a' || row.id === 'd');
    expect(adjacentEmail(remaining, 'b', 1, former)?.id).toBe('d');
    expect(adjacentEmail(remaining, 'b', -1, former)?.id).toBe('a');
  });
  it('steps into rows loaded after a removed last thread', () => {
    const former = emailPosition(rows, 'c');
    const loaded = [
      ...rows.filter((row) => row.id !== 'c'),
      { id: 'd', type: 'email' },
    ];
    expect(adjacentEmail(loaded, 'c', 1, former)?.id).toBe('d');
  });
});
