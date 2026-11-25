import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecentAgentSelections } from './recent-agent-selections';
import { createRecentModelSelections } from './recent-model-selections';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('recent model selections', () => {
  it('keeps newer in-memory choices when stored history cannot be updated', () => {
    localStorage.setItem(
      'agent-model-recent-v1:user-a',
      JSON.stringify(['a', 'b', 'c', 'd', 'e'])
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    createRoot((dispose) => {
      const recent = createRecentModelSelections('user-a');
      recent.remember('f');
      recent.refresh();
      expect(recent.ids()).toEqual(['f', 'a', 'b', 'c', 'd']);
      recent.remember('g');
      recent.refresh();
      expect(recent.ids()).toEqual(['g', 'f', 'a', 'b', 'c']);
      dispose();
    });
  });

  it('merges a changed storage payload from another selector', () => {
    createRoot((dispose) => {
      const first = createRecentModelSelections('user-a');
      const second = createRecentModelSelections('user-a');
      first.remember('a');
      first.remember('b');
      second.remember('c');
      first.refresh();
      expect(first.ids()).toEqual(['c', 'b', 'a']);
      expect(createRecentModelSelections('user-b').ids()).toEqual([]);
      dispose();
    });
  });

  it('preserves a newer choice when a merge write succeeds but the next write fails', () => {
    const key = 'agent-model-recent-v1:user-a';
    localStorage.setItem(key, JSON.stringify(['a', 'b', 'c', 'd', 'e']));
    createRoot((dispose) => {
      const recent = createRecentModelSelections('user-a');
      localStorage.setItem(key, JSON.stringify(['external']));
      const write = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem')
        .mockImplementationOnce(function (this: Storage, key, value) {
          write.call(this, key, value);
        })
        .mockImplementation(() => {
          throw new Error('Storage unavailable');
        });
      recent.remember('latest');
      recent.refresh();
      expect(recent.ids()).toEqual(['latest', 'external', 'a', 'b', 'c']);
      dispose();
    });
  });
});
