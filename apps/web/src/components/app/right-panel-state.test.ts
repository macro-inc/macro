import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (type: string) => (type === 'task' ? 'md' : type),
}));

import { createRightPanelState } from './right-panel-state';

describe('right reference tabs', () => {
  it('reuses a tab for repeated references and refreshes its location', () => {
    const state = createRightPanelState();
    state.open({ type: 'md', id: 'one' });
    state.rename('md:one', 'Proposal');
    state.open({ type: 'pdf', id: 'two' });
    state.open({ type: 'md', id: 'one', params: { nodeId: 'section' } });
    expect(state.tabs()).toHaveLength(2);
    expect(state.active()).toBe('md:one');
    expect(state.tabs()[0].title).toBe('Proposal');
    expect(state.tabs()[0].content.params).toEqual({ nodeId: 'section' });
  });
  it('preserves tabs on collapse and reopens on the next reference', () => {
    const state = createRightPanelState();
    state.open({ type: 'md', id: 'one' });
    state.setExpanded(false);
    expect(state.tabs()).toHaveLength(1);
    state.open({ type: 'md', id: 'one' });
    expect(state.expanded()).toBe(true);
    expect(state.tabs()).toHaveLength(1);
  });
  it('selects the adjacent tab on close and collapses after the last tab', () => {
    const state = createRightPanelState();
    state.open({ type: 'md', id: 'one' });
    state.open({ type: 'md', id: 'two' });
    state.open({ type: 'md', id: 'three' });
    state.select('md:two');
    state.close('md:two');
    expect(state.active()).toBe('md:three');
    state.close('md:one');
    expect(state.active()).toBe('md:three');
    state.close('md:three');
    expect(state.expanded()).toBe(false);
    expect(state.active()).toBeUndefined();
  });
});
