import type { Harness } from '@service-storage/client';
import { describe, expect, it } from 'vitest';
import { agentClaudeState, agentComputerHarness } from './team-agent-claude';

const computerHarness: Harness = {
  allow_permission_bypass: false,
  id: 'harness-ada',
  kind: 'macrod',
  name: "Ada's computer",
  owner: { type: 'user', user_id: 'macro|ada@agents.macro.invalid' },
  access: 'owner',
  shared_team_ids: [],
  created_by: 'macro|ada@agents.macro.invalid',
  created_at: '2026-11-11T09:00:00Z',
  updated_at: '2026-11-11T09:00:00Z',
  connected: true,
  last_connected_at: '2026-11-11T09:05:00Z',
  computer_id: 'computer-ada',
  claude_mode: 'macro_credits',
};

const pairedHarness: Harness = {
  ...computerHarness,
  id: 'harness-laptop',
  name: "Maya's laptop",
  computer_id: null,
};

describe('agentComputerHarness', () => {
  it("finds the runtime macrod enrolled on the agent's computer", () => {
    expect(
      agentComputerHarness('computer-ada', [pairedHarness, computerHarness])
    ).toBe(computerHarness);
  });

  it('has none before the computer is bought or before macrod enrolls', () => {
    expect(
      agentComputerHarness(null, [pairedHarness, computerHarness])
    ).toBeUndefined();
    expect(
      agentComputerHarness('computer-grace', [pairedHarness, computerHarness])
    ).toBeUndefined();
    expect(agentComputerHarness('computer-ada', undefined)).toBeUndefined();
  });
});

describe('agentClaudeState', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');

  it('waits for the computer to report its Claude mode', () => {
    expect(agentClaudeState(undefined, now)).toBe('loading');
  });

  it('runs on Macro credits without a sign-in', () => {
    expect(agentClaudeState({ mode: 'macro_credits' }, now)).toBe('credits');
  });

  it("uses the team's Claude plan while its sign-in has not expired", () => {
    expect(
      agentClaudeState(
        {
          mode: 'own_account',
          account: {
            signedInAt: '2026-11-01T12:00:00Z',
            signedInBy: 'macro|maya@example.com',
            expiresAt: '2027-11-01T12:00:00Z',
          },
        },
        now
      )
    ).toBe('signed_in');
    // Some credentials never report an expiry.
    expect(
      agentClaudeState(
        {
          mode: 'own_account',
          account: { signedInAt: '2026-11-01T12:00:00Z' },
        },
        now
      )
    ).toBe('signed_in');
  });

  it('needs a new sign-in once the credential expired', () => {
    expect(
      agentClaudeState(
        {
          mode: 'own_account',
          account: {
            signedInAt: '2025-11-01T12:00:00Z',
            expiresAt: '2026-11-13T12:00:00Z',
          },
        },
        now
      )
    ).toBe('expired');
  });
});
