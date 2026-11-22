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
const answer = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
const JS_TOOLS_PROGRAM = {
  source: 'await tools.email.send_message({ body: {} })',
  language: 'js_tools',
};
// The held program; each test may swap in another language's.
const held = vi.hoisted(() => ({
  program: { source: '', language: '' } as {
    source: string;
    language: string;
    module?: string;
  },
}));

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
              source: held.program.source,
              module: held.program.module,
              permission: {
                language: held.program.language,
                operations: [SEND],
              },
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
  held.program = JS_TOOLS_PROGRAM;
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
  it('asks the approver, listing what the program may do', async () => {
    renderRequest();
    expect(screen.getByText('Approval needed')).toBeTruthy();
    expect(
      screen.getByText('Scout wants to run a program that may:')
    ).toBeTruthy();
    expect(screen.getByText('Send message')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Allow for this session' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(answer.mock.calls).toEqual([
      ['approval-1', 'approve'],
      ['approval-1', 'approve_and_remember'],
      ['approval-1', 'deny'],
    ]);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Scout’s permissions' })
    );
    expect(settings.openSettingsInSplit).toHaveBeenCalledWith('Agents');
  });

  it('stays answerable without reading permissions while the flag is off', async () => {
    flags.permissions = false;
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(answer).toHaveBeenCalledWith('approval-1', 'approve');
    // Give a session read the chance to land: there must be none.
    await Promise.resolve();
    expect(client.session).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Scout’s permissions' })
    ).toBeNull();
  });

  it('shows the program on request', () => {
    renderRequest();
    const toggle = screen.getByRole('button', { name: 'View program' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText(JS_TOOLS_PROGRAM.source)).toBeTruthy();
  });

  it('shows the program and its module, each named', () => {
    held.program = {
      ...JS_TOOLS_PROGRAM,
      module: 'export const greeting = "hello";',
    };
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'View program' }));
    expect(screen.getByText('Program')).toBeTruthy();
    expect(screen.getByText(JS_TOOLS_PROGRAM.source)).toBeTruthy();
    expect(screen.getByText('Module, with no network')).toBeTruthy();
    expect(screen.getByText('export const greeting = "hello";')).toBeTruthy();
  });

  it('lets anyone else only stop waiting', () => {
    viewer.id = 'macro|julia@example.com';
    renderRequest();
    expect(screen.getByText('Waiting for Dana to approve')).toBeTruthy();
    expect(
      screen.getByText(
        "Scout wants to run a program with Dana's access that may:"
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(answer).toHaveBeenCalledWith('approval-1', 'cancel');
  });
});
