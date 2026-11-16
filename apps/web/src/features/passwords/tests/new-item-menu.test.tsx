import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NewItemMenu } from '../components/new-item-menu';

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('renders Import as its own menu section, laid out like the kind rows', async () => {
  const onImport = vi.fn();
  render(() => (
    <NewItemMenu
      presentation="toolbar"
      destination="Passwords"
      onCreate={vi.fn()}
      onImport={onImport}
    />
  ));
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'New item in Passwords' })
  );
  const login = await screen.findByRole('menuitem', { name: 'Login' });
  const importItem = screen.getByRole('menuitem', { name: 'Import…' });

  const loginGroup = login.closest('[role="group"]');
  const importGroup = importItem.closest('[role="group"]');
  expect(importGroup).not.toBeNull();
  expect(importGroup).not.toBe(loginGroup);
  expect(importGroup?.className).toBe(loginGroup?.className);
  expect(importItem.className).toBe(login.className);
  // Sections are divided by the menu surface itself, not an extra separator.
  expect(screen.queryByRole('separator')).toBeNull();

  await user.click(importItem);
  expect(onImport).toHaveBeenCalledOnce();
});
