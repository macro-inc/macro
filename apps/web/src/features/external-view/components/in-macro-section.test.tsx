import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOpenSections } from '../../whatsapp-linked/primitives/open-sections';
import { InMacroChats } from './in-macro-section';

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

it('lists readable chats with unread counts and marks read-only ones', () => {
  const onOpenChat = vi.fn();
  render(() => (
    <InMacroChats
      label="WhatsApp"
      chats={[
        {
          id: 'group-design',
          provider: 'whatsapp',
          kind: 'group',
          name: 'Design Crit',
          ownerId: 'macro|me@example.test',
          unreadCount: 3,
          canSend: true,
        },
        {
          id: 'group-family',
          provider: 'whatsapp',
          kind: 'group',
          name: 'Ana, Ben, +2',
          ownerId: 'macro|me@example.test',
          unreadCount: 0,
          canSend: false,
        },
        {
          id: 'chat-ana',
          provider: 'whatsapp',
          kind: 'direct',
          name: 'Ana Ruiz',
          ownerId: 'macro|me@example.test',
          unreadCount: 1,
          canSend: false,
        },
      ]}
      isPending={false}
      isError={false}
      activeChatId="group-family"
      isOpen={() => true}
      onOpenChange={vi.fn()}
      onOpenChat={onOpenChat}
      onRetry={vi.fn()}
    />
  ));
  const nav = within(
    screen.getByRole('navigation', { name: 'WhatsApp chats in Macro' })
  );
  const design = nav.getByRole('button', { name: /Design Crit/ });
  expect(within(design).getByLabelText('3 unread messages')).toBeTruthy();
  expect(within(design).queryByText('Read-only')).toBeNull();
  const family = nav.getByRole('button', { name: /Ana, Ben, \+2/ });
  expect(family.getAttribute('aria-current')).toBe('page');
  expect(within(family).getByText('Read-only')).toBeTruthy();
  // A shared direct chat: only its owner replies.
  const direct = nav.getByRole('button', { name: /Ana Ruiz/ });
  expect(
    within(direct).getByText(
      ': You can read this chat. Only its owner can reply.'
    )
  ).toBeTruthy();

  fireEvent.click(design);
  expect(onOpenChat).toHaveBeenCalledWith('group-design');
});

it('sorts chats into direct messages, groups and one section per community, like Chat', () => {
  const sections = createRoot(() =>
    createOpenSections('test:sidebar-sections', () => undefined)
  );
  const launch = { id: '120363000000000010@g.us', name: 'Launch' };
  render(() => (
    <InMacroChats
      label="WhatsApp"
      chats={[
        {
          id: 'chat-ana',
          provider: 'whatsapp',
          kind: 'direct',
          name: 'Ana Ruiz',
          ownerId: 'macro|me@example.test',
          unreadCount: 0,
          canSend: true,
        },
        {
          id: 'group-notices',
          provider: 'whatsapp',
          kind: 'group',
          name: 'Launch',
          ownerId: 'macro|me@example.test',
          unreadCount: 4,
          canSend: false,
          community: { ...launch, announcements: true },
        },
        {
          id: 'group-design',
          provider: 'whatsapp',
          kind: 'group',
          name: 'Design Crit',
          ownerId: 'macro|me@example.test',
          unreadCount: 2,
          canSend: true,
        },
        {
          id: 'group-launch-design',
          provider: 'whatsapp',
          kind: 'group',
          name: 'Design',
          ownerId: 'macro|me@example.test',
          unreadCount: 1,
          canSend: true,
          community: { ...launch, announcements: false },
        },
      ]}
      isPending={false}
      isError={false}
      activeChatId={undefined}
      isOpen={sections.isOpen}
      onOpenChange={sections.setOpen}
      onOpenChat={vi.fn()}
      onRetry={vi.fn()}
    />
  ));
  const rows = (label: string) =>
    within(screen.getByRole('navigation', { name: label }))
      .getAllByRole('button')
      .map((row) => row.getAttribute('title'));
  expect(rows('Direct messages')).toEqual(['Ana Ruiz']);
  expect(rows('Groups')).toEqual(['Design Crit']);
  // Under its community, a group goes by its own name, in recent order.
  expect(rows('Launch')).toEqual(['Announcements', 'Design']);
  expect(
    screen
      .getAllByRole('button', { expanded: true })
      .map((trigger) => trigger.textContent)
  ).toEqual(['Direct messages', 'Groups', 'Communities', 'Launch']);

  // A folded section keeps its unread count in sight.
  fireEvent.click(screen.getByRole('button', { name: 'Communities' }));
  expect(sections.isOpen('communities')).toBe(false);
  expect(screen.getByLabelText('5 unread messages')).toBeTruthy();
});
