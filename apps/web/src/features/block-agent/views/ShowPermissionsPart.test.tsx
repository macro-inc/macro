/**
 * @vitest-environment jsdom
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ToolCallCommon,
  ToolCallContext,
} from '../component/parts/shared';
import { ShowPermissionsPart } from './ShowPermissionsPart';

// `enable-agent-permissions`, by test.
const flags = vi.hoisted(() => ({ permissions: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: flags.permissions,
    loading: false,
  }),
}));

// The live card reads the permissions API; a marker is enough here.
vi.mock('@app/features/agent-permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/features/agent-permissions')>()),
  ShowPermissionsCard: (props: { agentName: string }) => (
    <div data-testid="show-permissions-card">{props.agentName}</div>
  ),
}));

vi.mock('../context/AgentSessionContext', () => ({
  useOptionalAgentSession: () => ({ bot: () => ({ name: 'Scout' }) }),
}));

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

const PART: ToolUsePart = {
  kind: 'tool_use',
  id: 'ShowPermissions-1',
  name: { kind: 'mcp', server: 'macro_internal', tool: 'ShowPermissions' },
  status: 'completed',
  detail: {
    kind: 'other',
    acpKind: 'other',
    input: { groups: [{ group: 'email' }] },
    output: null,
    result: {
      agentId: 'agent-1',
      sessionId: 'session-1',
      selection: { groups: [{ group: 'email', actions: ['send'] }], tools: [] },
      reason: null,
      current: [],
      message: '',
    },
    error: null,
  },
} as ToolUsePart;

const COMMON: ToolCallCommon = {
  id: 'ShowPermissions-1',
  label: 'ShowPermissions',
  status: 'completed',
  muted: false,
  stopped: false,
  trailing: undefined,
};

const CONTEXT: ToolCallContext = {
  sessionId: 'session-1',
  messageId: 'message-1',
  partIndex: 0,
  inFlight: false,
  followedBy: () => false,
};

function renderPart() {
  return render(() => (
    <ShowPermissionsPart part={PART} common={COMMON} context={CONTEXT} />
  ));
}

beforeEach(() => {
  flags.permissions = true;
});

afterEach(cleanup);

describe('ShowPermissionsPart', () => {
  it('shows the live permissions card with the flag on', () => {
    renderPart();
    expect(screen.getByTestId('show-permissions-card').textContent).toBe(
      'Scout'
    );
  });

  it('is a plain row with the flag off', () => {
    flags.permissions = false;
    renderPart();
    expect(screen.queryByTestId('show-permissions-card')).toBeNull();
    expect(screen.getAllByText('Show permissions').length).toBeGreaterThan(0);
  });
});
