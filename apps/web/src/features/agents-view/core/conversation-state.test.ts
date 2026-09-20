import { describe, expect, it } from 'vitest';
import {
  conversationState,
  conversationStateLabel,
} from './conversation-state';

describe('conversationState', () => {
  it('reads a session with no events yet as starting', () => {
    expect(conversationState(undefined)).toBe('starting');
    expect(conversationState('no_messages')).toBe('starting');
    expect(conversationState('booting')).toBe('starting');
  });

  it('reads a reachable runtime as live, whatever it last said', () => {
    expect(conversationState('acp_ready')).toBe('live');
    expect(conversationState('ready')).toBe('live');
    expect(conversationState('reload_required')).toBe('live');
    expect(conversationState('worktree_ready')).toBe('live');
  });

  it('reads an open fold turn as working, even when the runtime is ready', () => {
    expect(conversationState('acp_ready', 'running')).toBe('working');
    expect(conversationState('acp_ready', 'starting')).toBe('working');
    expect(conversationState('acp_ready', 'stopping')).toBe('working');
    expect(conversationState('no_messages', 'running')).toBe('working');
  });

  it('does not treat a blocked or idle turn as working', () => {
    expect(conversationState('acp_ready', 'blocked')).toBe('live');
    expect(conversationState('acp_ready', 'idle')).toBe('live');
    expect(conversationState('acp_ready', 'disconnected')).toBe('live');
  });

  it('reads a dropped transport as ended', () => {
    expect(conversationState('disconnected')).toBe('ended');
    expect(conversationState('session/end')).toBe('ended');
  });

  it('labels each state', () => {
    expect(conversationStateLabel('starting')).toBe('Starting');
    expect(conversationStateLabel('working')).toBe('Working');
    expect(conversationStateLabel('live')).toBe('Ready');
    expect(conversationStateLabel('ended')).toBe('Ended');
  });
});
