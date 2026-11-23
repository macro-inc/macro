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
import { err, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG, VIEW } from '../tests/fixtures';
import { AgentPermissionsPage } from './agent-permissions-page';

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

function renderPage(view: AgentToolPermissions = VIEW) {
  client.catalog.mockResolvedValue(ok(CATALOG));
  client.get.mockResolvedValue(ok(view));
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <AgentPermissionsPage
          agentId="agent-1"
          agentName="Scout"
          backLabel="Agents"
          onBack={() => {}}
        />
      </Suspense>
    </QueryClientProvider>
  ));
}

async function openGroup(name: string) {
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(name) })
  );
}

function option(control: string, state: 'Allow' | 'Ask' | 'Never') {
  return within(screen.getByRole('radiogroup', { name: control })).getByRole(
    'radio',
    { name: state }
  );
}

beforeEach(() => {
  // jsdom has no ResizeObserver; CollapseTransition measures with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  queryClient.clear();
  client.set.mockResolvedValue(ok(VIEW));
  client.reset.mockResolvedValue(ok({ ...VIEW, rules: [] }));
});

afterEach(() => vi.clearAllMocks());

describe('AgentPermissionsPage', () => {
  it('says plainly which programs the settings cover and what they miss', async () => {
    renderPage();
    expect(
      await screen.findByText(
        'Applies to every program Scout runs in sessions where agent permissions are on.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Scout’s other tools and your connected apps aren’t covered: they work as before, even where a setting says Never\./
      )
    ).toBeTruthy();
  });

  it('saves a group action', async () => {
    renderPage();
    await openGroup('Email');
    fireEvent.click(option('Email: Send', 'Never'));

    await waitFor(() =>
      expect(client.set).toHaveBeenCalledWith(
        'agent-1',
        {
          changes: [
            {
              target: { kind: 'group_action', group: 'email', action: 'send' },
              state: 'never',
            },
          ],
        },
        expect.anything()
      )
    );
  });

  it('clears a tool rule when the tool goes back to its action state', async () => {
    renderPage();
    await openGroup('Email');
    // One tool differs, so the list opens on Differs.
    fireEvent.click(option('Forward calendar event', 'Ask'));

    await waitFor(() =>
      expect(client.set.mock.calls[0]?.[1]).toEqual({
        changes: [
          {
            target: {
              kind: 'tool',
              service: 'email',
              operation: 'forward_event',
            },
            state: null,
          },
        ],
      })
    );
  });

  it('saves a tool against its action state while that action saves', async () => {
    // The Send change is still in flight when the tool is set.
    let finishSend: (value: unknown) => void = () => {};
    client.set.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSend = resolve;
      })
    );
    renderPage();
    await openGroup('Email');
    fireEvent.click(option('Email: Send', 'Never'));
    // Ask was Send's saved state, but no longer its state.
    fireEvent.click(option('Forward calendar event', 'Ask'));
    finishSend(ok(VIEW));

    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(2));
    expect(client.set.mock.calls[1]?.[1]).toEqual({
      changes: [
        {
          target: {
            kind: 'tool',
            service: 'email',
            operation: 'forward_event',
          },
          state: 'ask',
        },
      ],
    });
  });

  it("keeps a tool's own choice when its action's save fails", async () => {
    // Send (saved as Ask) is being set to Never when a tool is set to
    // Never too; then the Send save fails.
    let failSend: (value: unknown) => void = () => {};
    client.set.mockReturnValueOnce(
      new Promise((resolve) => {
        failSend = resolve;
      })
    );
    renderPage();
    await openGroup('Email');
    fireEvent.click(option('Email: Send', 'Never'));
    fireEvent.click(option('Forward calendar event', 'Never'));
    failSend(err([{ code: 'SERVER_ERROR', message: 'Server error' }]));

    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(2));
    expect(client.set.mock.calls[1]?.[1]).toEqual({
      changes: [
        {
          target: {
            kind: 'tool',
            service: 'email',
            operation: 'forward_event',
          },
          state: 'never',
        },
      ],
    });
  });

  it("lets a tool follow its action once the action's save lands", async () => {
    let finishSend: (value: unknown) => void = () => {};
    client.set.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSend = resolve;
      })
    );
    renderPage();
    await openGroup('Email');
    fireEvent.click(option('Email: Send', 'Never'));
    fireEvent.click(option('Forward calendar event', 'Never'));
    finishSend(ok(VIEW));

    await waitFor(() => expect(client.set).toHaveBeenCalledTimes(2));
    expect(client.set.mock.calls[1]?.[1]).toEqual({
      changes: [
        {
          target: {
            kind: 'tool',
            service: 'email',
            operation: 'forward_event',
          },
          state: null,
        },
      ],
    });
  });

  it('clears a tool rule from its reset button', async () => {
    renderPage();
    await openGroup('Email');
    fireEvent.click(
      screen.getByRole('button', { name: 'Use the Send setting' })
    );

    await waitFor(() =>
      expect(client.set.mock.calls[0]?.[1]).toEqual({
        changes: [
          {
            target: {
              kind: 'tool',
              service: 'email',
              operation: 'forward_event',
            },
            state: null,
          },
        ],
      })
    );
  });

  it('puts the control back and says so when a save fails', async () => {
    client.set.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Server error' }])
    );
    renderPage();
    await openGroup('Email');
    fireEvent.click(option('Email: Read', 'Never'));
    expect((option('Email: Read', 'Never') as HTMLInputElement).checked).toBe(
      true
    );

    await waitFor(() =>
      expect(toasts.failure).toHaveBeenCalledWith("Couldn't save Email: Read", {
        subtext: "It's back to Always allow. Try again.",
      })
    );
    expect((option('Email: Read', 'Allow') as HTMLInputElement).checked).toBe(
      true
    );
  });

  it('resets only after confirming', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reset permissions' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      'All 2 settings go back to Always allow. That includes one that Scout set for itself.'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(client.reset).not.toHaveBeenCalled();

    // The page's button comes first; the dialog is portaled after it.
    const [pageButton] = screen.getAllByRole('button', {
      name: 'Reset permissions',
    });
    fireEvent.click(pageButton);
    const confirm = (await screen.findAllByRole('dialog')).at(-1);
    if (!confirm) throw new Error('the confirmation reopened');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith('Permissions reset')
    );
    expect(client.reset).toHaveBeenCalledWith('agent-1', expect.anything());
  });

  it('narrows to what matches the search', async () => {
    renderPage();
    const search = await screen.findByRole('searchbox', {
      name: 'Search permissions',
    });
    fireEvent.input(search, { target: { value: 'send' } });

    expect(
      await screen.findByText('1 group · 1 tool match “send”')
    ).toBeTruthy();
    expect(
      screen.getByRole('radiogroup', { name: 'Email: Send' })
    ).toBeTruthy();
    expect(
      screen.getByRole('radiogroup', { name: 'Send message' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('radiogroup', { name: 'Email: Read' })
    ).toBeNull();
    expect(screen.queryByText('Documents')).toBeNull();
  });

  it('only shows the settings to someone who cannot edit the agent', async () => {
    renderPage({ ...VIEW, canEdit: false });
    await openGroup('Email');

    expect((option('Email: Send', 'Never') as HTMLInputElement).disabled).toBe(
      true
    );
    expect(
      screen.queryByRole('button', { name: 'Reset permissions' })
    ).toBeNull();
    expect(
      screen.getByText('Only people who can edit Scout can change these.')
    ).toBeTruthy();
  });

  it('says permissions are unavailable when the API is off', async () => {
    client.catalog.mockResolvedValue(ok(CATALOG));
    client.get.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
    );
    render(() => (
      <QueryClientProvider client={queryClient}>
        <AgentPermissionsPage
          agentId="agent-1"
          agentName="Scout"
          backLabel="Agents"
          onBack={() => {}}
        />
      </QueryClientProvider>
    ));
    expect(
      await screen.findByText("Permissions aren't available for this agent.")
    ).toBeTruthy();
  });
});
