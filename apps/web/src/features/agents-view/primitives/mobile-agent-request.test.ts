import { describe, expect, it } from 'vitest';
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
