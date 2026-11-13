import { describe, expect, it } from 'vitest';
import { dashboard } from '../tests/fake-dashboard';
import {
  agentProfileTarget,
  dashboardTitle,
  directMessageAgent,
} from './dashboard';

describe('dashboardTitle', () => {
  it("prefers the dashboard's title, then the view's", () => {
    expect(dashboardTitle(dashboard())).toBe('Operations');
    expect(
      dashboardTitle(
        dashboard({ title: null, view: { title: 'Board', widgets: [] } })
      )
    ).toBe('Board');
    expect(
      dashboardTitle(dashboard({ title: null, view: { widgets: [] } }))
    ).toBeUndefined();
  });
});

describe('directMessageAgent', () => {
  const agents = new Set(['macro|agent@example.com']);
  const isAgentAccount = (id: string) => agents.has(id);

  it('finds the agent on the other side of a DM', () => {
    expect(
      directMessageAgent({
        isDirectMessage: true,
        participantIds: ['macro|me@example.com', 'macro|agent@example.com'],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBe('macro|agent@example.com');
  });

  it('ignores people, group conversations and channels', () => {
    expect(
      directMessageAgent({
        isDirectMessage: true,
        participantIds: ['macro|me@example.com', 'macro|person@example.com'],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBeUndefined();
    expect(
      directMessageAgent({
        isDirectMessage: true,
        participantIds: [
          'macro|me@example.com',
          'macro|agent@example.com',
          'macro|person@example.com',
        ],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBeUndefined();
    expect(
      directMessageAgent({
        isDirectMessage: false,
        participantIds: ['macro|me@example.com', 'macro|agent@example.com'],
        viewerId: 'macro|me@example.com',
        isAgentAccount,
      })
    ).toBeUndefined();
  });

  it('waits for the viewer before deciding', () => {
    expect(
      directMessageAgent({
        isDirectMessage: true,
        participantIds: ['macro|me@example.com', 'macro|agent@example.com'],
        viewerId: undefined,
        isAgentAccount,
      })
    ).toBeUndefined();
  });
});

describe('agentProfileTarget', () => {
  const agents = new Set(['macro|agent@example.com']);
  const isAgentAccount = (id: string) => agents.has(id);

  it("opens an agent's profile when the flag is on", () => {
    expect(
      agentProfileTarget({
        userId: 'macro|agent@example.com',
        flagEnabled: true,
        isAgentAccount,
      })
    ).toBe('macro|agent@example.com');
  });

  it('leaves people, missing ids and the flag off alone', () => {
    expect(
      agentProfileTarget({
        userId: 'macro|person@example.com',
        flagEnabled: true,
        isAgentAccount,
      })
    ).toBeUndefined();
    expect(
      agentProfileTarget({
        userId: 'macro|agent@example.com',
        flagEnabled: false,
        isAgentAccount,
      })
    ).toBeUndefined();
    expect(
      agentProfileTarget({
        userId: undefined,
        flagEnabled: true,
        isAgentAccount,
      })
    ).toBeUndefined();
  });
});
