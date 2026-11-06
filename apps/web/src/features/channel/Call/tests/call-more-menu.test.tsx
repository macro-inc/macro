import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallMoreMenu } from '../CallControls/CallMoreMenu';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function openShortcuts(input: 'keyboard' | 'pointer' = 'keyboard') {
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
  if (input === 'pointer') await userEvent.setup().click(trigger);
  else fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menuItem = await screen.findByRole('menuitem', {
    name: 'Keyboard shortcuts',
  });
  if (input === 'pointer') await userEvent.setup().click(menuItem);
  else {
    menuItem.focus();
    fireEvent.keyDown(menuItem, { key: 'Enter' });
  }
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

it('keeps layout descriptions concise without a heading or persistence footer', async () => {
  render(() => (
    <CallMoreMenu
      layout="auto"
      onLayoutChange={() => {}}
      hasScreenShare
      hideParticipants={false}
      onHideParticipantsChange={() => {}}
      onOpenChange={() => {}}
    />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
    key: 'ArrowDown',
  });
  const layout = await screen.findByRole('menuitem', { name: /Layout/ });
  expect(screen.queryByText('For this call')).toBeNull();
  expect(
    document.querySelector('[data-macro-icon="users-slash"]')
  ).toBeTruthy();
  layout.focus();
  fireEvent.keyDown(layout, { key: 'ArrowRight' });
  await screen.findByRole('menuitemradio', { name: /^Auto/ });
  for (const text of [
    'Grid until someone shares',
    'Everyone the same size',
    'Speaker on stage, others below',
    'Speaker on stage, others to the side',
  ]) {
    expect(screen.getByText(text).classList.contains('whitespace-nowrap')).toBe(
      true
    );
  }
  expect(
    screen.queryByText('Your choice is kept for your next calls')
  ).toBeNull();
});

it.each([false, true])(
  'includes the reaction row only in compact More: %s',
  async (compact) => {
    render(() => (
      <CallMoreMenu
        compact={compact}
        layout="auto"
        onLayoutChange={() => {}}
        hasScreenShare={false}
        hideParticipants={false}
        onHideParticipantsChange={() => {}}
        onReaction={() => {}}
        onOpenChange={() => {}}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
      key: 'ArrowDown',
    });
    await screen.findByRole('menuitem', { name: /Layout/ });
    expect(!!screen.queryByRole('toolbar', { name: 'Reactions' })).toBe(
      compact
    );
  }
);

it('opens the shortcut popover through pointer selection without losing its anchor', async () => {
  const { dialog } = await openShortcuts('pointer');
  expect(dialog.isConnected).toBe(true);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Another action' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
