/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionsView } from '../queries/permissions-view';
import { ENTITY_CATALOG, ENTITY_VIEW } from '../tests/fixtures';
import { AgentPermissionsPanel } from './agent-permissions-panel';

const client = vi.hoisted(() => ({
  catalog: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  TOOL_PERMISSION_REFUSED: 'TOOL_PERMISSION_REFUSED',
  toolPermissionsClient: client,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: toasts }));

function renderPanel(view: PermissionsView = ENTITY_VIEW) {
  client.catalog.mockResolvedValue(ok(ENTITY_CATALOG));
  client.get.mockResolvedValue(ok(view));
  client.set.mockResolvedValue(ok(view));
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <AgentPermissionsPanel agentId="agent-2" agentName="Scout" />
      </Suspense>
    </QueryClientProvider>
  ));
}

/** Opens a dropdown from its trigger and picks a row by keyboard. */
function choose(trigger: HTMLElement, name: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = screen
    .getAllByRole('menu')
    .find((element) => element.getAttribute('aria-labelledby') === trigger.id);
  if (!menu) throw new Error('No menu for the trigger');
  const item = within(menu).getByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

function sentChanges() {
  return client.set.mock.calls.map((call) => call[1].changes);
}

async function expandRead() {
  fireEvent.click(
    await screen.findByRole('button', { name: /^Read(?! default)/ })
  );
  return screen.getByRole('region', { name: 'Read exceptions' });
}

beforeEach(() => {
  queryClient.clear();
  for (const mock of Object.values(client)) mock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AgentPermissionsPanel', () => {
  it('lists the actions in display order with their defaults', async () => {
    renderPanel();
    const defaults = await screen.findAllByRole('button', {
      name: / default permission$/,
    });
    expect(
      defaults.map((button) => [
        button.getAttribute('aria-label'),
        button.textContent,
      ])
    ).toEqual([
      ['Read default permission', 'Allow'],
      ['Create default permission', 'Ask'],
      ['Edit default permission', 'Ask'],
      ['Send default permission', 'Ask'],
      ['Delete default permission', 'Deny'],
    ]);
    expect(
      screen.getByRole('button', { name: /^Read(?! default)/ }).textContent
    ).toBe('Read2 exceptions');
  });

  it('saves a default, and Allow clears it', async () => {
    renderPanel();
    choose(
      await screen.findByRole('button', { name: 'Read default permission' }),
      'Ask'
    );
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    choose(
      await screen.findByRole('button', { name: 'Send default permission' }),
      'Allow'
    );
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(2));
    expect(sentChanges()).toEqual([
      [{ target: { kind: 'action', action: 'read' }, state: 'ask' }],
      [{ target: { kind: 'action', action: 'send' }, state: null }],
    ]);
  });

  it('shows the exceptions and the entities following the default', async () => {
    renderPanel();
    const read = await expandRead();
    expect(
      within(read).getByRole('button', { name: 'Contacts & CRM: Read' })
        .textContent
    ).toBe('Ask');
    expect(
      within(read).getByRole('button', { name: 'Outside chats: Read' })
        .textContent
    ).toBe('Deny');
    expect(read.textContent).toContain(
      'The other 4 entities follow the Read default.'
    );
  });

  it('adds an exception: an entity, then its permission', async () => {
    renderPanel();
    const read = await expandRead();
    choose(
      within(read).getByRole('button', { name: 'Add a Read exception' }),
      'Email'
    );
    // The new row's menu opens at once, which hides the rest from
    // assistive tech while it's open.
    const choosing = await within(read).findByRole('button', {
      name: 'Email: Read',
      hidden: true,
    });
    expect(choosing.textContent).toBe('Choose permission');
    const menu = await waitFor(() => {
      const found = screen
        .getAllByRole('menu')
        .find(
          (element) => element.getAttribute('aria-labelledby') === choosing.id
        );
      if (!found) throw new Error('menu not open yet');
      return found;
    });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Ask', 'Deny', 'Use default (Allow)']);
    const ask = within(menu).getByRole('menuitem', { name: 'Ask' });
    ask.focus();
    fireEvent.keyDown(ask, { key: 'Enter' });
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    expect(sentChanges()).toEqual([
      [
        {
          target: { kind: 'group_action', group: 'email', action: 'read' },
          state: 'ask',
        },
      ],
    ]);
  });

  it('Use default removes an exception', async () => {
    renderPanel();
    const read = await expandRead();
    choose(
      within(read).getByRole('button', { name: 'Contacts & CRM: Read' }),
      'Use default (Allow)'
    );
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    expect(sentChanges()).toEqual([
      [
        {
          target: { kind: 'group_action', group: 'contacts', action: 'read' },
          state: null,
        },
      ],
    ]);
  });

  it('keeps an exception row in place while its change saves', async () => {
    renderPanel();
    const read = await expandRead();
    const outside = within(read).getByRole('button', {
      name: 'Outside chats: Read',
    });
    choose(
      within(read).getByRole('button', { name: 'Contacts & CRM: Read' }),
      'Deny'
    );
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    // The other row was not remounted, so focus and open menus survive.
    expect(outside.isConnected).toBe(true);
  });

  it('never counts an exception on a pair no tool maps to', async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole('button', { name: /^Send(?! default)/ })
    );
    const send = screen.getByRole('region', { name: 'Send exceptions' });
    // Tasks · Send is saved, but Tasks has no Send tool.
    expect(
      screen.getByRole('button', { name: /^Send(?! default)/ }).textContent
    ).toBe('Send1 tool setting');
    expect(send.textContent).toContain(
      'All 2 entities follow the Send default.'
    );
    expect(screen.getByText('6 settings changed')).toBeTruthy();
  });

  it('lists a tool setting under its action and removes it', async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole('button', { name: /^Send(?! default)/ })
    );
    const send = screen.getByRole('region', { name: 'Send exceptions' });
    expect(send.textContent).toContain('Send message');
    expect(send.textContent).toContain('Set by agent');
    fireEvent.click(
      within(send).getByRole('button', {
        name: 'Remove the setting for Send message',
      })
    );
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    expect(sentChanges()).toEqual([
      [
        {
          target: {
            kind: 'tool',
            service: 'email',
            operation: 'send_message',
          },
          state: null,
        },
      ],
    ]);
  });

  it('is read-only for someone who can’t edit the agent', async () => {
    renderPanel({ ...ENTITY_VIEW, canEdit: false });
    const read = await expandRead();
    expect(
      (
        screen.getByRole('button', {
          name: 'Read default permission',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      within(read).queryByRole('button', { name: 'Add a Read exception' })
    ).toBeNull();
    expect(
      screen.getByText('Only people who can edit Scout can change these.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset permissions' })).toBe(
      null
    );
  });

  it('opens at the action a link points to', async () => {
    client.catalog.mockResolvedValue(ok(ENTITY_CATALOG));
    client.get.mockResolvedValue(ok(ENTITY_VIEW));
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Suspense>
          <AgentPermissionsPanel
            agentId="agent-2"
            agentName="Scout"
            focus={{
              group: 'email',
              tool: { service: 'email', operation: 'send_message' },
            }}
          />
        </Suspense>
      </QueryClientProvider>
    ));
    expect(
      await screen.findByRole('region', { name: 'Send exceptions' })
    ).toBeTruthy();
  });
});
