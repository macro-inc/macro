import { describe, expect, it } from 'vitest';
import { agentAttentionState, isAgentSessionRunning } from './agent-attention';

const session = (
  overrides: Partial<Parameters<typeof agentAttentionState>[0]> = {}
) => ({
  pendingPermissionCount: 0,
  statusKind: 'event' as const,
  statusEventName: 'acp_ready',
  prUrl: undefined,
  ...overrides,
});

describe('agentAttentionState', () => {
  it('puts sessions waiting on a person first, whatever else is true', () => {
    expect(
      agentAttentionState(
        session({
          pendingPermissionCount: 2,
          statusKind: 'disconnected',
          statusEventName: undefined,
          prUrl: 'https://github.com/acme/widgets/pull/1',
        })
      )
    ).toBe('needs_approval');
  });

  it('treats live sessions as running', () => {
    expect(agentAttentionState(session())).toBe('running');
    expect(
      agentAttentionState(session({ statusEventName: 'worktree_ready' }))
    ).toBe('running');
    expect(agentAttentionState(session({ statusEventName: 'booting' }))).toBe(
      'running'
    );
  });

  it('treats a just-opened session with no status yet as running', () => {
    expect(
      agentAttentionState(
        session({ statusKind: 'no_messages', statusEventName: undefined })
      )
    ).toBe('running');
  });

  it('conservatively counts unknown event names as running', () => {
    expect(
      agentAttentionState(session({ statusEventName: 'vendor/custom-event' }))
    ).toBe('running');
  });

  it('surfaces a finished session with a PR as pr_ready', () => {
    expect(
      agentAttentionState(
        session({
          statusKind: 'disconnected',
          statusEventName: undefined,
          prUrl: 'https://github.com/acme/widgets/pull/1',
        })
      )
    ).toBe('pr_ready');
  });

  it('sinks disconnected and shutting-down sessions to past', () => {
    expect(
      agentAttentionState(
        session({ statusKind: 'disconnected', statusEventName: undefined })
      )
    ).toBe('past');
    expect(
      agentAttentionState(session({ statusEventName: 'shutting_down' }))
    ).toBe('past');
    expect(
      agentAttentionState(session({ statusEventName: 'disconnected' }))
    ).toBe('past');
  });
});

describe('isAgentSessionRunning', () => {
  it('never counts a disconnected session as running', () => {
    expect(
      isAgentSessionRunning({
        statusKind: 'disconnected',
        statusEventName: undefined,
      })
    ).toBe(false);
  });
});
