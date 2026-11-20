import { describe, expect, it } from 'vitest';
import { publishSessionActivity, useSessionActivity } from './session-activity';
import { publishSessionTurn } from './session-turn';

describe('session activity line', () => {
  it('follows the newest line and drops it when the server clears it', () => {
    const line = useSessionActivity(() => 'cleared');

    publishSessionActivity('cleared', 'Reading files…');
    expect(line()).toBe('Reading files…');
    publishSessionActivity('cleared', 'Searching your workspace…');
    expect(line()).toBe('Searching your workspace…');
    publishSessionActivity('cleared', null);
    expect(line()).toBeUndefined();
  });

  it('drops the line when the turn settles, even without a server clear', () => {
    const line = useSessionActivity(() => 'settled');
    publishSessionTurn('settled', 'running');
    publishSessionActivity('settled', 'Running tests…');

    publishSessionTurn('settled', 'idle');

    expect(line()).toBeUndefined();
  });

  it('keeps the line while the turn is still working', () => {
    const line = useSessionActivity(() => 'working');
    publishSessionTurn('working', 'starting');
    publishSessionActivity('working', 'Running tests…');

    publishSessionTurn('working', 'running');

    expect(line()).toBe('Running tests…');
  });
});
