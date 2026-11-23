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
import { createSignal, Suspense } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANDIDATES,
  ENTITY_CATALOG,
  ENTITY_VIEW,
  FOLLOWING_VIEW,
} from '../tests/fixtures';
import {
  applyPermissionsDraft,
  EditAgentPermissions,
  NewAgentPermissions,
  type PermissionsDraft,
} from './agent-permissions-form';
import { AgentPermissionsPanel } from './agent-permissions-panel';

const client = vi.hoisted(() => ({
  catalog: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
  sources: vi.fn(),
  policy: vi.fn(),
  setSource: vi.fn(),
  detach: vi.fn(),
}));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  TOOL_PERMISSION_REFUSED: 'TOOL_PERMISSION_REFUSED',
  toolPermissionsClient: client,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: toasts }));

/** Opens a dropdown from its trigger and picks a row by keyboard. */
function choose(trigger: HTMLElement, name: string | RegExp) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = screen
    .getAllByRole('menu')
    .find((element) => element.getAttribute('aria-labelledby') === trigger.id);
  if (!menu) throw new Error('No menu for the trigger');
  const item = within(menu).getByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

function option(control: string, state: 'Allow' | 'Ask' | 'Never') {
  return within(screen.getByRole('radiogroup', { name: control })).getByRole(
    'radio',
    { name: state }
  );
}

function tab(name: string) {
  return within(
    screen.getByRole('radiogroup', { name: 'Permissions' })
  ).getByRole('radio', { name });
}

function wrap(children: () => unknown) {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>{children() as never}</Suspense>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  queryClient.clear();
  for (const mock of Object.values(client)) mock.mockReset();
  client.catalog.mockResolvedValue(ok(ENTITY_CATALOG));
  client.sources.mockResolvedValue(ok({ candidates: CANDIDATES }));
  client.policy.mockResolvedValue(ok(ENTITY_VIEW));
});

describe('NewAgentPermissions', () => {
  function renderNew() {
    let read: (() => PermissionsDraft) | undefined;
    const [share, setShare] = createSignal<'Private' | 'Team'>('Private');
    wrap(() => (
      <NewAgentPermissions
        share={share()}
        draft={(reader) => {
          read = reader;
        }}
      />
    ));
    return {
      draft: () => {
        if (!read) throw new Error('no draft reader');
        return read();
      },
      setShare,
    };
  }

  it('follows personal Macro by default, and Set agent picks another', async () => {
    const form = renderNew();
    expect(
      await screen.findByText(
        'This agent automatically follows permission changes made to @macro.'
      )
    ).toBeTruthy();
    expect(form.draft()).toMatchObject({
      mode: 'source',
      sourcePolicyId: 'policy-macro',
      defaultPolicyId: 'policy-macro',
    });

    choose(screen.getByRole('button', { name: /Set agent/ }), /Scout/);
    expect(
      await screen.findByText(
        'This agent automatically follows permission changes made to @scout.'
      )
    ).toBeTruthy();
    expect(form.draft().sourcePolicyId).toBe('policy-scout');
  });

  it('lists an agent that would loop, disabled with the reason', async () => {
    renderNew();
    // The picker beside the default source, once the candidates are in.
    await screen.findByText(
      'This agent automatically follows permission changes made to @macro.'
    );
    const trigger = screen.getByRole('button', { name: /Set agent/ });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const analyst = screen.getByRole('menuitem', { name: /Analyst/ });
    expect(analyst.getAttribute('aria-disabled')).toBe('true');
    expect(analyst.textContent).toContain('Would follow itself');
  });

  it('starts own permissions from the source and records changes', async () => {
    const form = renderNew();
    await screen.findByRole('button', { name: /Set agent/ });
    fireEvent.click(tab('Set my own permissions'));
    await screen.findByRole('radiogroup', {
      name: 'Create default permission',
    });
    // Prefilled from the source's resolved permissions.
    expect(
      (option('Create default permission', 'Ask') as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(option('Create default permission', 'Never'));
    await waitFor(() =>
      expect(
        (option('Create default permission', 'Never') as HTMLInputElement)
          .checked
      ).toBe(true)
    );
    expect(form.draft()).toMatchObject({
      mode: 'own',
      sourcePolicyId: 'policy-macro',
      changes: [
        { target: { kind: 'action', action: 'create' }, state: 'never' },
      ],
    });
    // Nothing is saved before the agent exists.
    expect(client.set).not.toHaveBeenCalled();
  });
});

describe('NewAgentPermissions draft', () => {
  it('starts own changes over when another agent is picked', async () => {
    let read: (() => PermissionsDraft) | undefined;
    wrap(() => (
      <NewAgentPermissions
        share="Private"
        draft={(reader) => {
          read = reader;
        }}
      />
    ));
    await screen.findByRole('button', { name: /Set agent/ });
    fireEvent.click(tab('Set my own permissions'));
    fireEvent.click(
      await waitFor(() => option('Create default permission', 'Never'))
    );
    expect(read?.().changes).toHaveLength(1);
    fireEvent.click(tab('Use another agent’s permissions'));
    choose(screen.getByRole('button', { name: /Set agent/ }), /Scout/);
    await waitFor(() =>
      expect(read?.()).toMatchObject({
        sourcePolicyId: 'policy-scout',
        changes: [],
      })
    );
  });
});

describe('applyPermissionsDraft', () => {
  it('follows a picked agent that is not the default', async () => {
    client.setSource.mockResolvedValue(ok(FOLLOWING_VIEW));
    const result = await applyPermissionsDraft('new-agent', {
      mode: 'source',
      sourcePolicyId: 'policy-scout',
      defaultPolicyId: 'policy-macro',
      changes: [],
    });
    expect(result.isOk()).toBe(true);
    expect(client.setSource.mock.calls[0]?.slice(0, 2)).toEqual([
      'new-agent',
      { sourcePolicyId: 'policy-scout' },
    ]);
    expect(client.detach).not.toHaveBeenCalled();
  });

  it('sends nothing for the default source', async () => {
    await applyPermissionsDraft('new-agent', {
      mode: 'source',
      sourcePolicyId: 'policy-macro',
      defaultPolicyId: 'policy-macro',
      changes: [],
    });
    expect(client.setSource).not.toHaveBeenCalled();
    expect(client.detach).not.toHaveBeenCalled();
  });

  it("detaches with the draft's last change per target", async () => {
    client.detach.mockResolvedValue(ok(ENTITY_VIEW));
    await applyPermissionsDraft('new-agent', {
      mode: 'own',
      sourcePolicyId: 'policy-macro',
      defaultPolicyId: 'policy-macro',
      changes: [
        { target: { kind: 'action', action: 'send' }, state: 'never' },
        { target: { kind: 'action', action: 'send' }, state: 'ask' },
      ],
    });
    expect(client.setSource).not.toHaveBeenCalled();
    expect(client.detach.mock.calls[0]?.slice(0, 2)).toEqual([
      'new-agent',
      {
        changes: [{ target: { kind: 'action', action: 'send' }, state: 'ask' }],
      },
    ]);
  });
});

describe('EditAgentPermissions', () => {
  function renderEdit(view: AgentToolPermissions) {
    client.get.mockResolvedValue(ok(view));
    wrap(() => <EditAgentPermissions agentId="agent-2" agentName="Analyst" />);
  }

  it('shows what a following agent follows, and uses its own on request', async () => {
    client.detach.mockResolvedValue(ok(ENTITY_VIEW));
    renderEdit(FOLLOWING_VIEW);
    expect(
      await screen.findByText(
        'This agent automatically follows permission changes made to @scout.',
        { exact: false }
      )
    ).toBeTruthy();
    expect(
      screen.getByText('@scout follows @macro.', { exact: false })
    ).toBeTruthy();
    fireEvent.click(tab('Set my own permissions'));
    // Choosing the tab alone changes nothing.
    expect(client.detach).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use my own permissions' })
    );
    await waitFor(() =>
      expect(client.detach.mock.calls[0]?.slice(0, 2)).toEqual(['agent-2', {}])
    );
  });

  it('asks before an agent with its own permissions follows another', async () => {
    client.setSource.mockResolvedValue(ok(FOLLOWING_VIEW));
    renderEdit({ ...ENTITY_VIEW, canSetSource: true });
    await screen.findByRole('radiogroup', { name: 'Permissions' });
    fireEvent.click(tab('Use another agent’s permissions'));
    choose(await screen.findByRole('button', { name: /Set agent/ }), /Scout/);
    expect(client.setSource).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }));
    await waitFor(() =>
      expect(client.setSource.mock.calls[0]?.slice(0, 2)).toEqual([
        'agent-2',
        { sourcePolicyId: 'policy-scout' },
      ])
    );
  });
});

describe('a following agent in its row', () => {
  it('is read-only, inherits exceptions, and its own restriction is removable', async () => {
    client.get.mockResolvedValue(ok(FOLLOWING_VIEW));
    client.set.mockResolvedValue(ok(FOLLOWING_VIEW));
    wrap(() => <AgentPermissionsPanel agentId="agent-2" agentName="Analyst" />);
    expect(
      await screen.findByText(
        'This agent automatically follows permission changes made to @scout.',
        { exact: false }
      )
    ).toBeTruthy();
    expect(
      (option('Read default permission', 'Ask') as HTMLInputElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Read(?! default)/ }));
    const read = screen.getByRole('region', { name: 'Read exceptions' });
    // Inherited from Scout, and the agent's own restriction on Email.
    expect(
      within(read).getByRole('radiogroup', { name: 'Contacts & CRM: Read' })
    ).toBeTruthy();
    expect(read.textContent).toContain('Restricted by the agent: Never');
    expect(
      within(read).queryByRole('button', { name: 'Add a Read exception' })
    ).toBeNull();
    fireEvent.click(
      within(read).getByRole('button', {
        name: 'Remove the restriction on Email: Read',
      })
    );
    await waitFor(() =>
      expect(client.set.mock.calls[0]?.slice(0, 2)).toEqual([
        'agent-2',
        {
          changes: [
            {
              target: { kind: 'group_action', group: 'email', action: 'read' },
              state: null,
            },
          ],
        },
      ])
    );
  });
});
