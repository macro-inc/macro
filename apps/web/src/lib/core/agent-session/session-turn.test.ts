import { afterEach, describe, expect, it } from 'vitest';
import {
  hasSessionActivity,
  isWorkingTurn,
  noteSessionActivity,
  publishSessionTurn,
  resetSessionTurns,
  sessionTurn,
  subscribeSessionTurns,
} from './session-turn';

afterEach(() => {
  resetSessionTurns();
});

describe('isWorkingTurn', () => {
  it('treats an open or stopping turn as work', () => {
    expect(isWorkingTurn('starting')).toBe(true);
    expect(isWorkingTurn('running')).toBe(true);
    expect(isWorkingTurn('stopping')).toBe(true);
  });

  it('does not treat a settled or blocked turn as work', () => {
    expect(isWorkingTurn('idle')).toBe(false);
    expect(isWorkingTurn('blocked')).toBe(false);
    expect(isWorkingTurn('disconnected')).toBe(false);
    expect(isWorkingTurn(undefined)).toBe(false);
  });
});

describe('session turn store', () => {
  it('publishes a turn and notifies listeners only when it changes', () => {
    const seen: string[] = [];
    const stop = subscribeSessionTurns((id) => seen.push(id));
    publishSessionTurn('a', 'running');
    publishSessionTurn('a', 'running');
    publishSessionTurn('a', 'idle');
    expect(sessionTurn('a')).toBe('idle');
    expect(seen).toEqual(['a', 'a']);
    stop();
  });

  it('marks recent activity for a session nobody has open', () => {
    expect(hasSessionActivity('b')).toBe(false);
    noteSessionActivity('b');
    expect(hasSessionActivity('b')).toBe(true);
  });
});
