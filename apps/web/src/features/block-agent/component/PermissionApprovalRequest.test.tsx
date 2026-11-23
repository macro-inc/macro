/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeldToolApproval } from '../primitives/create-tool-approval-controller';
import { PermissionApprovalRequest } from './PermissionApprovalRequest';

const SEND = {
  service: 'email',
  operation: 'send_message',
  label: 'Send message',
  group: 'email',
  groupName: 'Email',
  action: 'send',
  state: 'ask',
  origin: 'group_action',
};

const REQUEST: HeldToolApproval = {
  kind: 'tool_approval',
  approvalId: 'approval-1',
  turn: 1,
  serverSlug: 'macro-sdk',
  serverName: 'Macro',
  toolName: 'ExecuteCode',
  requestedBy: 'macro|dana@example.com',
  approver: 'macro|dana@example.com',
};

const viewer = vi.hoisted(() => ({ id: 'macro|dana@example.com' }));
const SOURCE = 'await tools.email.send_message({ body: {} })';
// The held program; a test may add a module.
const held = vi.hoisted(() => ({ module: undefined as string | undefined }));
const answer = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('../context/AgentSessionContext', () => ({
  useOptionalAgentSession: () => ({
    sessionId: () => 'session-1',
    session: () => ({ ownerId: 'macro|dana@example.com' }),
    bot: () => ({ name: 'Scout' }),
    displayName: (id: string) => (id.includes('dana') ? 'Dana' : id),
    messages: () => [
      {
        parts: [
          {
            kind: 'tool_approval',
            approvalId: 'approval-1',
            arguments: {
              source: 'await tools.email.send_message({ body: {} })',
              module: held.module,
              permission: { language: 'js_tools', operations: [SEND] },
            },
          },
        ],
      },
    ],
    toolApprovals: {
      canApprove: (request?: HeldToolApproval) =>
        (request?.approver ?? 'macro|dana@example.com') === viewer.id,
      canCancel: () => true,
      answering: () => false,
      answer,
    },
  }),
}));

const client = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@service-agent-harness/tool-permissions', () => ({
  TOOL_PERMISSION_REFUSED: 'TOOL_PERMISSION_REFUSED',
  toolPermissionsClient: client,
}));

// `enable-agent-permissions`, by test.
const flags = vi.hoisted(() => ({ permissions: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: flags.permissions,
    loading: false,
  }),
}));

const settings = vi.hoisted(() => ({ openSettingsInSplit: vi.fn() }));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => settings,
}));

function renderRequest() {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <PermissionApprovalRequest request={REQUEST} />
      </Suspense>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  queryClient.clear();
  viewer.id = 'macro|dana@example.com';
  held.module = undefined;
  flags.permissions = true;
  client.session.mockResolvedValue(
    ok({ agentId: 'agent-1', canEdit: true, groups: [], rules: [] })
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PermissionApprovalRequest', () => {
  it('asks the approver in one sentence, accenting what it would do', () => {
    renderRequest();
    const request = screen.getByRole('region', {
      name: 'Permission approval request',
    });
    expect(request.textContent).toContain('Allow Scout to send email?');
    const accented = [...request.querySelectorAll('.text-accent')].map(
      (span) => span.textContent
    );
    expect(accented).toEqual(['send', 'email']);
  });

  it('answers once, for the session, or no', () => {
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow in this session' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(answer.mock.calls).toEqual([
      ['approval-1', 'approve'],
      ['approval-1', 'approve_and_remember'],
      ['approval-1', 'deny'],
    ]);
  });

  it('keeps View program, then Deny and Edit permissions, then the Allows', async () => {
    renderRequest();
    await screen.findByRole('button', { name: 'Edit permissions' });
    expect(
      screen.getAllByRole('button').map((button) => button.textContent)
    ).toEqual([
      'View program',
      'Deny',
      'Edit permissions',
      'Allow once',
      'Allow in this session',
    ]);
    expect(
      screen
        .getByRole('button', { name: 'Allow in this session' })
        .getAttribute('data-variant')
    ).toBe('primary');
  });

  it('opens the agent’s permissions in settings from Edit permissions', async () => {
    renderRequest();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit permissions' })
    );
    expect(settings.openSettingsInSplit).toHaveBeenCalledWith('Agents');
  });

  it('offers Edit permissions only to someone who may edit the agent', async () => {
    client.session.mockResolvedValue(
      ok({ agentId: 'agent-1', canEdit: false, groups: [], rules: [] })
    );
    renderRequest();
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Edit permissions' })).toBe(
      null
    );
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy();
  });

  it('stays answerable without reading permissions while the flag is off', async () => {
    flags.permissions = false;
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(answer).toHaveBeenCalledWith('approval-1', 'approve');
    // Give a session read the chance to land: there must be none.
    await Promise.resolve();
    expect(client.session).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Edit permissions' })
    ).toBeNull();
  });

  it('shows the program and what it may call on request', () => {
    renderRequest();
    expect(screen.queryByText(SOURCE)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'View program' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(SOURCE)).toBeTruthy();
    expect(screen.getByText('Send message')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide program' }));
    expect(screen.queryByText(SOURCE)).toBeNull();
  });

  it('shows the program and its module, each named', () => {
    held.module = 'export const greeting = "hello";';
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'View program' }));
    expect(screen.getByText('Program')).toBeTruthy();
    expect(screen.getByText(SOURCE)).toBeTruthy();
    expect(screen.getByText('Module, with no network')).toBeTruthy();
    expect(screen.getByText('export const greeting = "hello";')).toBeTruthy();
  });

  it('lets anyone else only stop waiting', () => {
    viewer.id = 'macro|julia@example.com';
    renderRequest();
    expect(screen.getByText('Waiting for Dana to approve')).toBeTruthy();
    expect(
      screen.getByText('Scout wants to send email with Dana’s access.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(answer).toHaveBeenCalledWith('approval-1', 'cancel');
  });
});
