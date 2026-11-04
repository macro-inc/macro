import { describe, expect, it } from 'vitest';
import { capabilityFacts } from './capability-row';

const row = {
  account: 'Connected account',
  scope: 'personal',
  mechanism: 'pipedream',
} as const;

describe('capabilityFacts', () => {
  it('credits Macro Connect for a Connect grant when the flag is on', () => {
    expect(capabilityFacts({ ...row, grantProvider: 'connect' }, true)).toBe(
      'Powered by Macro Connect'
    );
  });

  it('keeps the Pipedream label on a real Pipedream grant when the flag is on', () => {
    expect(capabilityFacts({ ...row, grantProvider: 'pipedream' }, true)).toBe(
      'Powered by Pipedream'
    );
  });

  it.each(['connect', 'pipedream', undefined] as const)(
    'keeps the Pipedream label when the flag is off (grant: %s)',
    (grantProvider) => {
      expect(capabilityFacts({ ...row, grantProvider }, false)).toBe(
        'Powered by Pipedream'
      );
    }
  );

  it('names what would run an unconnected provider, by flag', () => {
    expect(capabilityFacts(undefined, true)).toBe('Powered by Macro Connect');
    expect(capabilityFacts(undefined, false)).toBe('Powered by Pipedream');
  });

  it('shows the account and scope for a native MCP server, whatever the flag', () => {
    const native = { ...row, mechanism: 'native-mcp' } as const;
    expect(capabilityFacts(native, true)).toBe('Connected account · Personal');
    expect(capabilityFacts(native, false)).toBe('Connected account · Personal');
  });
});
