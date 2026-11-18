/** @vitest-environment jsdom */

import {
  ContextMenuContent,
  ContextMenuTrigger,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Dropdown } from '@ui/components/Dropdown';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationMuteMenu } from './NotificationMuteMenu';

vi.mock('@icon/system/regular/bell-simple.svg', () => ({
  default: () => <svg aria-hidden="true" />,
}));
vi.mock('@icon/system/regular/bell-slash.svg', () => ({
  default: () => <svg aria-hidden="true" />,
}));
vi.mock('@icon/system/regular/check.svg', () => ({
  default: () => <svg aria-hidden="true" />,
}));
vi.mock('@icon/system/regular/caret-right.svg?component-solid', () => ({
  default: () => <svg aria-hidden="true" />,
}));

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('opens mute durations from the context menu and selects a choice with the keyboard', async () => {
  const onMute = vi.fn();
  const onSnooze = vi.fn();
  const complete = vi.fn();
  render(() => (
    <ContextMenu>
      <ContextMenuTrigger>Document</ContextMenuTrigger>
      <ContextMenuContent>
        <NotificationMuteMenu
          label="Mute"
          unmuteLabel="Unmute"
          muted={false}
          onMute={onMute}
          onSnooze={onSnooze}
          onActionComplete={complete}
        />
      </ContextMenuContent>
    </ContextMenu>
  ));
  fireEvent.contextMenu(screen.getByText('Document'));
  const trigger = await screen.findByRole('menuitem', { name: 'Mute' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const indefinite = await screen.findByRole('menuitem', {
    name: 'Until I turn it off',
  });
  indefinite.focus();
  fireEvent.keyDown(indefinite, { key: 'Enter' });
  expect(onMute).toHaveBeenCalledWith(true);
  expect(onSnooze).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
});

it('opens mute durations in a dropdown and preserves trailing deadlines and completion', async () => {
  const onMute = vi.fn();
  const onSnooze = vi.fn();
  const complete = vi.fn();
  render(() => (
    <Dropdown>
      <Dropdown.Trigger>Actions</Dropdown.Trigger>
      <Dropdown.Content>
        <NotificationMuteMenu
          label="Mute"
          unmuteLabel="Unmute"
          muted={false}
          menu="dropdown"
          onMute={onMute}
          onSnooze={onSnooze}
          onActionComplete={complete}
        />
        <Dropdown.Item>Another action</Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), {
    key: 'Enter',
  });
  const trigger = await screen.findByRole('menuitem', { name: 'Mute' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const option = await screen.findByRole('menuitem', { name: /30 minutes/ });
  expect(option.querySelector('.text-xs')?.textContent).toBeTruthy();
  option.focus();
  fireEvent.keyDown(option, { key: 'Enter' });
  expect(onSnooze).toHaveBeenCalledOnce();
  expect(onSnooze.mock.calls[0]?.[0]).toBeInstanceOf(Date);
  expect(onMute).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
});

it('keeps the dropdown unmute action disabled when the target is disabled', () => {
  const onMute = vi.fn();
  render(() => (
    <Dropdown open>
      <Dropdown.Trigger>Actions</Dropdown.Trigger>
      <Dropdown.Content>
        <NotificationMuteMenu
          label="Mute"
          unmuteLabel="Unmute"
          muted
          disabled
          menu="dropdown"
          onMute={onMute}
          onSnooze={vi.fn()}
        />
      </Dropdown.Content>
    </Dropdown>
  ));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unmute' }));
  expect(onMute).not.toHaveBeenCalled();
});
