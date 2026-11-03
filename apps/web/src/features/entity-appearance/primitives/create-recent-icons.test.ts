import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecentIcons } from './create-recent-icons';

afterEach(() => localStorage.clear());

describe('recent icon preferences', () => {
  it('bounds, deduplicates, and persists picks without sharing accounts', () => {
    const first = createRoot((dispose) => ({
      dispose,
      recent: createRecentIcons('first'),
    }));
    for (const name of [
      'star',
      'flag',
      'heart',
      'calendar-blank',
      'file',
      'book-open',
      'database',
      'code',
      'bug',
      'cpu',
    ]) {
      first.recent.record({ kind: 'macro', name });
    }
    first.recent.record({ kind: 'macro', name: 'file' });
    expect(first.recent.icons()).toHaveLength(9);
    expect(first.recent.icons()[0]).toEqual({ kind: 'macro', name: 'file' });
    expect(
      first.recent
        .icons()
        .filter((icon) => icon.kind === 'macro' && icon.name === 'file')
    ).toHaveLength(1);
    const second = createRoot((dispose) => ({
      dispose,
      recent: createRecentIcons('second'),
    }));
    expect(second.recent.icons()).toEqual([]);
    const restored = createRoot((dispose) => ({
      dispose,
      recent: createRecentIcons('first'),
    }));
    expect(restored.recent.icons()).toEqual(first.recent.icons());
    first.dispose();
    second.dispose();
    restored.dispose();
  });

  it('ignores malformed, retired, and unknown picks when reading and recording', () => {
    localStorage.setItem(
      'entity-icons:recent:first',
      JSON.stringify([
        null,
        { kind: 'macro', name: 'align-bottom-simple' },
        { kind: 'macro', name: 'calendar-dots' },
        { kind: 'macro', name: 'unknown-icon' },
        { kind: 'macro', name: 'star' },
        { kind: 'emoji', value: '🚀' },
        { kind: 'emoji', value: 42 },
      ])
    );
    const { recent, dispose } = createRoot((dispose) => ({
      dispose,
      recent: createRecentIcons('first'),
    }));
    recent.record({ kind: 'macro', name: 'calendar-dots' });
    recent.record({ kind: 'macro', name: 'unknown-icon' });
    expect(recent.icons()).toEqual([
      { kind: 'macro', name: 'star' },
      { kind: 'emoji', value: '🚀' },
    ]);
    dispose();
  });
});
