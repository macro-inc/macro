import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CallMoreMenu } from '../CallControls/CallMoreMenu';

afterEach(cleanup);
async function openShortcuts() {
  const openChanged = vi.fn();
  render(() => (
    <div class="portal-scope" data-testid="call-root">
      <CallMoreMenu
        layout="auto"
        onLayoutChange={() => {}}
        hasScreenShare={false}
        hideParticipants={false}
        onHideParticipantsChange={() => {}}
        onOpenChange={openChanged}
        fullscreenAvailable
        onFullscreen={() => {}}
      />
      <button type="button">Another action</button>
    </div>
  ));
  const trigger = screen.getByRole('button', { name: 'More' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menuItem = await screen.findByRole('menuitem', {
    name: 'Keyboard shortcuts',
  });
  menuItem.focus();
  fireEvent.keyDown(menuItem, { key: 'Enter' });
  const dialog = await screen.findByRole('dialog', {
    name: 'Keyboard shortcuts',
  });
  expect(screen.getByTestId('call-root').contains(dialog)).toBe(true);
  await waitFor(() =>
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4)
  );
  return { trigger, dialog, openChanged };
}

it('opens exactly the call shortcuts above More and returns focus on Escape', async () => {
  const { trigger, dialog, openChanged } = await openShortcuts();
  for (const text of [
    'Mute or unmute',
    'Turn camera on or off',
    'Hold to talk while muted',
    'Enter or leave full screen',
  ]) {
    expect(within(dialog).getByText(text)).toBeTruthy();
  }
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  screen
    .getByRole('dialog', { name: 'Keyboard shortcuts' })
    .dispatchEvent(escapeEvent);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(openChanged).toHaveBeenLastCalledWith(false);
});

it('preserves focus on an outside control when the popover dismisses', async () => {
  await openShortcuts();
  const other = screen.getByRole('button', { name: 'Another action' });
  other.focus();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(other));
});
