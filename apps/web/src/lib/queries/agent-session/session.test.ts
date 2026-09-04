import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { describe, expect, it } from 'vitest';
import { sessionMayProvideExternalUrl } from './session';

function session(
  overrides: Partial<AgentSessionResponse> = {}
): AgentSessionResponse {
  return {
    botId: 'bot-id',
    createdAt: '2026-09-04T12:00:00Z',
    harness: 'claude-code',
    id: 'session-id',
    model: 'model',
    modifiedAt: '2026-09-04T12:00:00Z',
    name: 'Agent session',
    ownerId: 'user-id',
    sandboxSize: 'small',
    status: { kind: 'no_messages' },
    workspace: '/workspace',
    ...overrides,
  };
}

describe('sessionMayProvideExternalUrl', () => {
  it('uses persisted external provider metadata', () => {
    expect(
      sessionMayProvideExternalUrl(
        session({ external: { provider: 'external-provider' } })
      )
    ).toBe(true);
  });

  it('uses the persisted harness while external metadata is pending', () => {
    expect(sessionMayProvideExternalUrl(session({ harness: 'cursor' }))).toBe(
      true
    );
  });

  it('does not poll managed sessions', () => {
    expect(sessionMayProvideExternalUrl(session())).toBe(false);
  });
});
