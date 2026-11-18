import { describe, expect, it, vi } from 'vitest';
import { mobileAgentRequest } from './mobile-agent-request';

describe('phone agent request', () => {
  it('records the requested kind and gives repeated selections fresh identities', () => {
    mobileAgentRequest.select('user', 'chat-agent', 'agent');
    const first = mobileAgentRequest.forUser('user');
    expect(first?.agentId).toBe('chat-agent');
    expect(first?.kind).toBe('agent');
    mobileAgentRequest.select('user', 'chat-agent', 'agent');
    expect(mobileAgentRequest.forUser('user')?.request).not.toBe(
      first?.request
    );
    mobileAgentRequest.select('user', 'code-agent', 'coder');
    expect(mobileAgentRequest.forUser('user')?.kind).toBe('coder');
    expect(mobileAgentRequest.forUser('other')).toBeUndefined();
  });
});
describe('mobileAgentRequest focus registration', () => {
  it('focuses synchronously for the selected identity only', () => {
    const focus = vi.fn();
    const unregister = mobileAgentRequest.registerFocus('test-owner', focus);
    mobileAgentRequest.select('another-owner', 'agent-a', 'agent');
    expect(focus).not.toHaveBeenCalled();
    mobileAgentRequest.select('test-owner', 'agent-a', 'agent');
    expect(focus).toHaveBeenCalledOnce();
    unregister();
    mobileAgentRequest.select('test-owner', 'agent-b', 'agent');
    expect(focus).toHaveBeenCalledOnce();
  });
  it('keeps a newer registration when an older mount cleans up', () => {
    const unregisterOld = mobileAgentRequest.registerFocus(
      'test-owner',
      vi.fn()
    );
    const focus = vi.fn();
    const unregisterNew = mobileAgentRequest.registerFocus('test-owner', focus);
    unregisterOld();
    mobileAgentRequest.select('test-owner', 'agent-a', 'agent');
    expect(focus).toHaveBeenCalledOnce();
    unregisterNew();
  });
});
