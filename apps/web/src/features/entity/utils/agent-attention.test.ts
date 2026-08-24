import { describe, expect, it } from 'vitest';
import type { AgentSessionEntity } from '../types/entity';
import { agentAttentionState } from './agent-attention';

const session = (
  overrides: Partial<AgentSessionEntity> = {}
): AgentSessionEntity => ({
  type: 'agent_session',
  id: 's-1',
  name: 'Claude Code',
  ownerId: 'macro|owner@example.com',
  model: 'claude-sonnet-5',
  harness: 'claude-code',
  statusKind: 'event',
  statusEventName: 'acp_ready',
  pendingPermissionCount: 0,
  ...overrides,
});

describe('agentAttentionState', () => {
  it('puts sessions awaiting a permission answer first, whatever else holds', () => {
    expect(agentAttentionState(session({ pendingPermissionCount: 2 }))).toBe(
      'needs_approval'
    );
    // A blocked session outranks its PR and its running status.
    expect(
      agentAttentionState(
        session({
          pendingPermissionCount: 1,
          prUrl: 'https://github.com/macro-inc/macro/pull/1',
          statusEventName: 'booting',
        })
      )
    ).toBe('needs_approval');
  });

  it('treats provisioning and worktree setup as running', () => {
    expect(agentAttentionState(session({ statusKind: 'no_messages' }))).toBe(
      'running'
    );
    expect(agentAttentionState(session({ statusEventName: 'booting' }))).toBe(
      'running'
    );
    expect(
      agentAttentionState(session({ statusEventName: 'worktree_ready' }))
    ).toBe('running');
  });

  it('does not claim idle, closing, or unknown statuses as running', () => {
    expect(agentAttentionState(session({ statusEventName: 'acp_ready' }))).toBe(
      'past'
    );
    expect(
      agentAttentionState(session({ statusEventName: 'shutting_down' }))
    ).toBe('past');
    expect(
      agentAttentionState(session({ statusEventName: 'something_new' }))
    ).toBe('past');
    expect(agentAttentionState(session({ statusKind: 'disconnected' }))).toBe(
      'past'
    );
  });

  it('surfaces a produced PR once the session is not running', () => {
    expect(
      agentAttentionState(
        session({ prUrl: 'https://github.com/macro-inc/macro/pull/1' })
      )
    ).toBe('pr_ready');
    expect(
      agentAttentionState(
        session({
          statusKind: 'disconnected',
          prUrl: 'https://github.com/macro-inc/macro/pull/1',
        })
      )
    ).toBe('pr_ready');
    // Still working: the PR badge waits until the run settles.
    expect(
      agentAttentionState(
        session({
          statusEventName: 'booting',
          prUrl: 'https://github.com/macro-inc/macro/pull/1',
        })
      )
    ).toBe('running');
  });
});
