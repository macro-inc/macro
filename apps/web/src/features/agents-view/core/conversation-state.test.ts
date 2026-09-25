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
    expect(conversationState('booting', 'idle')).toBe('starting');
    expect(conversationState('no_messages', 'idle')).toBe('starting');
  });

  it('reads a reachable idle runtime as dormant, whatever it last said', () => {
    expect(conversationState('acp_ready')).toBe('dormant');
    expect(conversationState('ready')).toBe('dormant');
    expect(conversationState('reload_required')).toBe('dormant');
    expect(conversationState('worktree_ready')).toBe('dormant');
  });

  it('reads an open fold turn as working, even when the runtime is ready', () => {
    expect(conversationState('acp_ready', 'running')).toBe('working');
    expect(conversationState('acp_ready', 'starting')).toBe('starting');
    expect(conversationState('acp_ready', 'stopping')).toBe('working');
    expect(conversationState('no_messages', 'running')).toBe('working');
  });

  it('does not treat a blocked or idle turn as working', () => {
    expect(conversationState('acp_ready', 'blocked')).toBe('waiting');
    expect(conversationState('acp_ready', 'idle')).toBe('dormant');
    expect(conversationState('acp_ready', 'disconnected')).toBe('dormant');
  });

  it('reads a dropped transport as dormant', () => {
    expect(conversationState('disconnected')).toBe('dormant');
    expect(conversationState('session/end')).toBe('dormant');
  });

  it('labels each state', () => {
    expect(conversationStateLabel('starting')).toBe('Starting');
    expect(conversationStateLabel('working')).toBe('Working');
    expect(conversationStateLabel('dormant')).toBe('Dormant');
    expect(conversationStateLabel('waiting')).toBe('Waiting for input');
  });
});
