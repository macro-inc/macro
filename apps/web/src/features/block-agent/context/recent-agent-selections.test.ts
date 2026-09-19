import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecentAgentSelections } from './recent-agent-selections';

beforeEach(() => window.localStorage.clear());

describe('recent agent selections', () => {
  it('remembers five distinct choices, newest first, across composer mounts', () => {
    createRoot((dispose) => {
      const recent = createRecentAgentSelections('user-a');
      for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) recent.remember(id);
      expect(recent.ids()).toEqual(['c', 'f', 'e', 'd', 'b']);
      dispose();
    });
    createRoot((dispose) => {
      expect(createRecentAgentSelections('user-a').ids()).toEqual([
        'c',
        'f',
        'e',
        'd',
        'b',
      ]);
      expect(createRecentAgentSelections('user-b').ids()).toEqual([]);
      dispose();
    });
  });

  it('ignores malformed history', () => {
    window.localStorage.setItem('agent-session-recent-v1:user-a', 'not json');
    createRoot((dispose) => {
      expect(createRecentAgentSelections('user-a').ids()).toEqual([]);
      dispose();
    });
  });

  it('keeps working when storage cannot be written', () => {
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Storage unavailable');
      });
    createRoot((dispose) => {
      const recent = createRecentAgentSelections('user-a');
      recent.remember('a');
      expect(recent.ids()).toEqual(['a']);
      dispose();
    });
    write.mockRestore();
  });
});
