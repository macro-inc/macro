import { describe, expect, it, vi } from 'vitest';
import { agentScreenName } from './agent-name';

const names = vi.hoisted(
  () =>
    new Map<string, { firstName: string; lastName: string }>([
      ['macro|dee@agents.example', { firstName: 'Dee', lastName: '' }],
    ])
);

vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  // Loading, or no name: the parts are empty (the full name would be the email).
  getDisplayNameParts: (id: string) => ({
    ...(names.get(id) ?? { firstName: '', lastName: '' }),
    fullName: id,
  }),
}));

describe('agentScreenName', () => {
  it('is the agent account’s name once loaded', () => {
    expect(
      agentScreenName({
        team_agent_user_id: 'macro|dee@agents.example',
        name: 'computer',
      })
    ).toBe('Dee');
  });

  it('is the harness’s name while the account’s name loads, never its email', () => {
    expect(
      agentScreenName({
        team_agent_user_id: 'macro|loading@agents.example',
        name: 'Dee’s computer',
      })
    ).toBe('Dee’s computer');
  });

  it('is empty without a harness', () => {
    expect(agentScreenName(undefined)).toBe('');
  });
});
