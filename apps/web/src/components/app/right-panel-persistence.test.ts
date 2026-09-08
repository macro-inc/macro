/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/block', () => ({
  BlockRegistry: ['md', 'pdf', 'channel'],
  BlockAliasRegistry: ['task'],
}));
vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (type: string) => (type === 'task' ? 'md' : type),
}));

import { createRightPanelRegistry } from './right-panel-persistence';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    key: (index: number) => [...values.keys()][index] ?? null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('reference panels belong to their main content', () => {
  it('keeps channel attachments separate and restores each channel on return', () => {
    const registry = createRightPanelRegistry('user');
    const first = registry.forContent('channel:one');
    first.open({ type: 'md', id: 'attachment' });
    first.rename('md:attachment', 'Proposal');
    const second = registry.forContent('channel:two');
    expect(second.tabs()).toEqual([]);
    second.open({ type: 'pdf', id: 'contract' });
    expect(
      registry
        .forContent('channel:one')
        .tabs()
        .map((tab) => tab.title)
    ).toEqual(['Proposal']);
    expect(registry.forContent('channel:two').active()).toBe('pdf:contract');
  });

  it('restores tab order, selection, locations, and collapse after remount or reload', () => {
    const original = createRightPanelRegistry('user').forContent('channel:one');
    original.open({
      type: 'md',
      id: 'attachment',
      params: { nodeId: 'section' },
    });
    original.rename('md:attachment', 'Proposal');
    original.open({ type: 'pdf', id: 'contract' });
    original.select('md:attachment');
    original.setExpanded(false);
    const restored = createRightPanelRegistry('user').forContent('channel:one');
    expect(restored.tabs()).toEqual(original.tabs());
    expect(restored.active()).toBe('md:attachment');
    expect(restored.expanded()).toBe(false);
    restored.open({
      type: 'md',
      id: 'attachment',
      params: { nodeId: 'other' },
    });
    expect(restored.tabs()).toHaveLength(2);
    expect(restored.expanded()).toBe(true);
  });

  it('persists closing and isolates users', () => {
    const original = createRightPanelRegistry('user').forContent('channel:one');
    original.open({ type: 'md', id: 'attachment' });
    expect(
      createRightPanelRegistry('other-user').forContent('channel:one').tabs()
    ).toEqual([]);
    original.close('md:attachment');
    const restored = createRightPanelRegistry('user').forContent('channel:one');
    expect(restored.tabs()).toEqual([]);
    expect(restored.expanded()).toBe(false);
  });

  it('ignores invalid persisted content', () => {
    const original = createRightPanelRegistry('user').forContent('channel:one');
    original.open({ type: 'md', id: 'attachment' });
    const key = localStorage.key(0)!;
    localStorage.setItem(
      key,
      JSON.stringify({
        tabs: [{ title: 'Bad', content: { type: 'not-a-block', id: 'x' } }],
        expanded: true,
      })
    );
    expect(
      createRightPanelRegistry('user').forContent('channel:one').tabs()
    ).toEqual([]);
    localStorage.setItem(key, '{');
    expect(
      createRightPanelRegistry('user').forContent('channel:one').tabs()
    ).toEqual([]);
  });
});
