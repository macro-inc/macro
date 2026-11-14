import { expect, test } from 'bun:test';
import { misplaced } from '../state.ts';

test('memory and private are committed: anything tracked in another bucket, or in none, is misplaced', () => {
  expect(
    misplaced([
      'memory/shared/notes.md',
      'memory/heartbeat/merges.md',
      'private/chat/history/c.jsonl',
      'run/heartbeat/tick.json',
      'log/agent/wakes.jsonl',
      'notes.md',
      'shots/screen.png',
    ])
  ).toEqual({
    local: ['run/heartbeat/tick.json', 'log/agent/wakes.jsonl'],
    stray: ['notes.md', 'shots/screen.png'],
  });
  expect(misplaced(['memory/x', 'private/people/a.json'])).toEqual({
    local: [],
    stray: [],
  });
});
