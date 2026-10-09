import { describe, expect, it, vi } from 'vitest';
import { CommandState } from './state';

describe('command menu hint', () => {
  it('lasts until the menu closes', () => {
    const run = vi.fn();
    CommandState.setHint({
      message: 'Did you mean to open the design palette?',
      shortcut: '⌘P',
      matches: (e) => e.metaKey && e.code === 'KeyP',
      run,
    });
    CommandState.onMenuOpen();
    expect(CommandState.hint()?.shortcut).toBe('⌘P');
    CommandState.onMenuClose();
    expect(CommandState.hint()).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('command menu query', () => {
  it('does not carry a closed search into the next opening', () => {
    CommandState.onMenuOpen();
    CommandState.setQuery('kappelhoff');
    CommandState.onMenuClose();
    expect(CommandState.query()).toBe('');
  });
});
