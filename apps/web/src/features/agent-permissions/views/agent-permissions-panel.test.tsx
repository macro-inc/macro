/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import type { AgentToolPermissions } from '@service-agent-harness/generated/schemas';
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

function renderPanel(view: AgentToolPermissions = ENTITY_VIEW) {
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

/** Picks a dropdown row by keyboard (the entity picker). */
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

/** A segmented control's option. */
function option(
  control: string,
  state: 'Allow' | 'Ask' | 'Never',
  scope: HTMLElement = document.body
) {
  return within(
    within(scope).getByRole('radiogroup', { name: control })
  ).getByRole('radio', { name: state });
}

/** The highlighted option of a segmented control. */
function saved(control: string, scope: HTMLElement = document.body) {
  const states = ['Allow', 'Ask', 'Never'] as const;
  return states.find(
    (state) => (option(control, state, scope) as HTMLInputElement).checked
  );
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
    const defaults = await screen.findAllByRole('radiogroup', {
      name: / default permission$/,
    });
    expect(
      defaults.map((group) => [
        group.getAttribute('aria-label'),
        saved(group.getAttribute('aria-label') ?? ''),
      ])
    ).toEqual([
      ['Read default permission', 'Allow'],
      ['Create default permission', 'Ask'],
      ['Edit default permission', 'Ask'],
      ['Send default permission', 'Ask'],
      ['Delete default permission', 'Never'],
    ]);
    expect(
      screen.getByRole('button', { name: /^Read(?! default)/ }).textContent
    ).toBe('Read2 exceptions');
  });

  it('saves a default, and Allow clears it', async () => {
    renderPanel();
    await screen.findByRole('radiogroup', { name: 'Read default permission' });
    fireEvent.click(option('Read default permission', 'Ask'));
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    fireEvent.click(option('Send default permission', 'Allow'));
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(2));
    expect(sentChanges()).toEqual([
      [{ target: { kind: 'action', action: 'read' }, state: 'ask' }],
      [{ target: { kind: 'action', action: 'send' }, state: null }],
    ]);
  });

  it('shows the exceptions and the entities following the default', async () => {
    renderPanel();
    const read = await expandRead();
    expect(saved('Contacts & CRM: Read', read)).toBe('Ask');
    expect(saved('Outside chats: Read', read)).toBe('Never');
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
    // The new row has nothing highlighted until a state is picked.
    await within(read).findByRole('radiogroup', { name: 'Email: Read' });
    expect(saved('Email: Read', read)).toBeUndefined();
    expect(client.set).not.toHaveBeenCalled();
    fireEvent.click(option('Email: Read', 'Ask', read));
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

  it('cancels a new exception without saving', async () => {
    renderPanel();
    const read = await expandRead();
    choose(
      within(read).getByRole('button', { name: 'Add a Read exception' }),
      'Email'
    );
    await within(read).findByRole('radiogroup', { name: 'Email: Read' });
    fireEvent.click(
      within(read).getByRole('button', {
        name: 'Email: use default (Allow)',
      })
    );
    expect(
      within(read).queryByRole('radiogroup', { name: 'Email: Read' })
    ).toBe(null);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('Use default removes an exception', async () => {
    renderPanel();
    const read = await expandRead();
    fireEvent.click(
      within(read).getByRole('button', {
        name: 'Contacts & CRM: use default (Allow)',
      })
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
    const outside = within(read).getByRole('radiogroup', {
      name: 'Outside chats: Read',
    });
    fireEvent.click(option('Contacts & CRM: Read', 'Never', read));
    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(1));
    // The other row was not remounted, so focus survives.
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
      (option('Read default permission', 'Ask') as HTMLButtonElement).disabled
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
