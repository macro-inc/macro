/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { CommandState } from './state';

afterEach(() => {
  CommandState.close();
  CommandState.onMenuClose();
  CommandState.forceReset();
});
it('opens a clean picker with its destination attached', () => {
  CommandState.setQuery('old query');
  CommandState.setCategoryFilter('commands');
  const pick = vi.fn();
  CommandState.openEntityPicker(pick);
  expect(CommandState.isOpen()).toBe(true);
  expect(CommandState.query()).toBe('');
  expect(CommandState.categoryFilter()).toBe('all');
  expect(CommandState.entityPicker()).toBe(pick);
  expect(pick).not.toHaveBeenCalled();
});
it('clears the picker destination on dismissal so normal Cmd+K does not add tabs', () => {
  CommandState.openEntityPicker(vi.fn());
  CommandState.close();
  CommandState.onMenuClose();
  CommandState.open();
  expect(CommandState.entityPicker()).toBeUndefined();
});
