import { describe, expect, it } from 'vitest';
import type { CreatableBlock } from '../types';
import { groupRecentCreateMenuItems } from './create-menu-details';
import { recentLauncherBlocks, sortLauncherBlocks } from './launcher-history';

const item = (label: string, hotkey: string): CreatableBlock => ({
  label,
  hotkey: hotkey as CreatableBlock['hotkey'],
  blockName: 'md',
  description: label,
  keyDownHandler: () => true,
});

describe('launcher recent usage', () => {
  it('takes only the three most recent available, previously used options', () => {
    const items = [
      item('Document', 'd'),
      item('Email', 'e'),
      item('Task', 't'),
      item('Folder', 'f'),
      item('Snippet', 's'),
    ];
    const recent = recentLauncherBlocks(items, {
      'Document:d': { count: 10, lastUsedAt: 1000 },
      'Email:e': { count: 1, lastUsedAt: 4000 },
      'Task:t': { count: 2, lastUsedAt: 3000 },
      'Folder:f': { count: 3, lastUsedAt: 2000 },
      'Disabled:x': { count: 1, lastUsedAt: 5000 },
    });
    expect(recent.map((entry) => entry.label)).toEqual([
      'Email',
      'Task',
      'Folder',
    ]);
    const sections = groupRecentCreateMenuItems(items, recent);
    expect(
      sections.map((section) => [
        section.group.label,
        section.items.map((entry) => entry.label),
      ])
    ).toEqual([
      ['Recents', ['Email', 'Task', 'Folder']],
      ['Docs & files', ['Document', 'Snippet']],
    ]);
    expect(sections.flatMap((section) => section.items)).toHaveLength(
      items.length
    );
  });

  it('omits Recents without history rather than filling it with unused options', () => {
    const items = [item('Email', 'e'), item('Document', 'd')];
    expect(recentLauncherBlocks(items, {})).toEqual([]);
    expect(
      groupRecentCreateMenuItems(items, []).map(
        (section) => section.group.label
      )
    ).toEqual(['Docs & files', 'Communicate']);
  });

  it('filters recent choices without promoting other search results into Recents', () => {
    const document = item('Document', 'd');
    const email = item('Email', 'e');
    const task = item('Task', 't');
    expect(
      groupRecentCreateMenuItems([document, task], [email, task]).map(
        (section) => [
          section.group.label,
          section.items.map((entry) => entry.label),
        ]
      )
    ).toEqual([
      ['Recents', ['Task']],
      ['Docs & files', ['Document']],
    ]);
    expect(groupRecentCreateMenuItems([], [email, task])).toEqual([]);
  });

  it('puts the most recent choice first even when an older choice was used more', () => {
    const items = [
      item('Document', 'd'),
      item('Email', 'e'),
      item('Task', 't'),
    ];
    const sorted = sortLauncherBlocks(items, {
      'Document:d': { count: 100, lastUsedAt: 1000 },
      'Task:t': { count: 1, lastUsedAt: 2000 },
    });
    expect(sorted.map((entry) => entry.label)).toEqual([
      'Task',
      'Document',
      'Email',
    ]);
    expect(items.map((entry) => entry.label)).toEqual([
      'Document',
      'Email',
      'Task',
    ]);
  });

  it('preserves catalog order for new items and equal timestamps', () => {
    const items = [
      item('Document', 'd'),
      item('Email', 'e'),
      item('Task', 't'),
    ];
    expect(sortLauncherBlocks(items, {})).toEqual(items);
    expect(
      sortLauncherBlocks(items, {
        'Document:d': { count: 1, lastUsedAt: 1000 },
        'Email:e': { count: 20, lastUsedAt: 1000 },
      })
    ).toEqual(items);
  });
});
