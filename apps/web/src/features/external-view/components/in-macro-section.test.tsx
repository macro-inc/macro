import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InMacroGroups } from './in-macro-section';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lists readable groups with unread counts and marks read-only ones', () => {
  const onOpenGroup = vi.fn();
  render(() => (
    <InMacroGroups
      groups={[
        {
          id: 'group-design',
          name: 'Design Crit',
          unreadCount: 3,
          canSend: true,
        },
        {
          id: 'group-family',
          name: 'Ana, Ben, +2',
          unreadCount: 0,
          canSend: false,
        },
      ]}
      isPending={false}
      isError={false}
      activeGroupId="group-family"
      onOpenGroup={onOpenGroup}
      onRetry={vi.fn()}
    />
  ));
  const nav = within(
    screen.getByRole('navigation', { name: 'WhatsApp groups in Macro' })
  );
  const design = nav.getByRole('button', { name: /Design Crit/ });
  expect(within(design).getByLabelText('3 unread messages')).toBeTruthy();
  expect(within(design).queryByText('Read-only')).toBeNull();
  const family = nav.getByRole('button', { name: /Ana, Ben, \+2/ });
  expect(family.getAttribute('aria-current')).toBe('page');
  expect(within(family).getByText('Read-only')).toBeTruthy();

  fireEvent.click(design);
  expect(onOpenGroup).toHaveBeenCalledWith('group-design');
});
