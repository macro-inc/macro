import type { AgentSessionLiveState } from '@queries/agent-session/live-list-state';
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

const live = (
  overrides: Partial<AgentSessionLiveState> = {}
): AgentSessionLiveState => ({
  title: null,
  statusEvent: 'acp_ready',
  working: false,
  pendingPermissionCount: 0,
  ...overrides,
});

describe('agentAttentionState', () => {
  it('puts alive sessions awaiting a permission answer first, whatever else holds', () => {
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

  it('treats every alive container as running from snapshot columns alone', () => {
    // Snapshot columns cannot tell working from idle — both sit at
    // `acp_ready` — so alive errs toward running rather than past.
    expect(agentAttentionState(session({ statusKind: 'no_messages' }))).toBe(
      'running'
    );
    expect(agentAttentionState(session({ statusEventName: 'booting' }))).toBe(
      'running'
    );
    expect(agentAttentionState(session({ statusEventName: 'acp_ready' }))).toBe(
      'running'
    );
    expect(
      agentAttentionState(session({ statusEventName: 'something_new' }))
    ).toBe('running');
  });

  it('sends disconnected sessions to past, in either status shape', () => {
    expect(agentAttentionState(session({ statusKind: 'disconnected' }))).toBe(
      'past'
    );
    // A live disconnect arrives as an event frame keeping the wire name.
    expect(
      agentAttentionState(session({ statusEventName: 'disconnected' }))
    ).toBe('past');
  });

  it('follows the stream over the snapshot when live state is passed', () => {
    // The snapshot says alive; the stream already saw the disconnect.
    expect(
      agentAttentionState(session(), live({ statusEvent: 'disconnected' }))
    ).toBe('past');
    // The snapshot says disconnected; the stream says the runtime is back.
    expect(
      agentAttentionState(
        session({ statusKind: 'disconnected' }),
        live({ working: true })
      )
    ).toBe('running');
  });

  it('reads pending permissions from the fold when following live', () => {
    expect(
      agentAttentionState(
        session({ pendingPermissionCount: 3 }),
        live({ pendingPermissionCount: 0, working: true })
      )
    ).toBe('running');
    expect(
      agentAttentionState(session(), live({ pendingPermissionCount: 1 }))
    ).toBe('needs_approval');
  });

  it('surfaces a produced PR once the fold says the run settled', () => {
    const prUrl = 'https://github.com/macro-inc/macro/pull/1';
    // Alive and idle with a PR out: the deliverable wants the user.
    expect(
      agentAttentionState(session({ prUrl }), live({ working: false }))
    ).toBe('pr_ready');
    // Still working: the PR bucket waits until the run settles.
    expect(
      agentAttentionState(session({ prUrl }), live({ working: true }))
    ).toBe('running');
    // The container is gone: the PR is what remains.
    expect(
      agentAttentionState(session({ statusKind: 'disconnected', prUrl }))
    ).toBe('pr_ready');
    // Without live state an alive container stays running — the fold, not
    // the snapshot, is what can say the run settled.
    expect(agentAttentionState(session({ prUrl }))).toBe('running');
  });
});
