import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { Topbar } from './Topbar';

vi.mock('@app/components/view-shell/ViewShell', () => ({
  ViewSidebarToggle: () => null,
}));
afterEach(cleanup);

it('uses the shared session menu and closes after an action', async () => {
  const rename = vi.fn();
  render(() => (
    <Topbar
      title="Session"
      session={{
        favorite: false,
        onRename: rename,
        onCopyLink: vi.fn(),
        onDelete: vi.fn(),
        onToggleFavorite: vi.fn(),
        onShare: vi.fn(),
        onSidePanel: vi.fn(),
      }}
    />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Session menu' }), {
    key: 'Enter',
  });
  expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeTruthy();
  expect(
    screen.getByRole('menuitem', { name: 'Add to favorites' })
  ).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'Delete session' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename' }), {
    key: 'Enter',
  });
  expect(rename).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Session menu' })
        .getAttribute('aria-expanded')
    ).toBe('false')
  );
});

it('does not show a session menu before a session exists', () => {
  render(() => <Topbar title="New conversation" />);
  expect(screen.queryByRole('button', { name: 'Session menu' })).toBeNull();
});
