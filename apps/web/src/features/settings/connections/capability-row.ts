import type { Capability, CapabilityScope } from './model';

const SCOPE_LABEL: Record<CapabilityScope, string> = {
  personal: 'Personal',
  shared: 'Shared',
};

/**
 * With no row, names what would serve the provider once connected. Gated on
 * the `macro-connect` flag: without it every connection is labeled Pipedream.
 */
export function capabilityFacts(
  row:
    | Pick<Capability, 'account' | 'scope' | 'mechanism' | 'grantProvider'>
    | undefined,
  macroConnectEnabled: boolean
): string {
  if (!row || row.mechanism === 'pipedream') {
    const onConnect =
      macroConnectEnabled && (!row || row.grantProvider === 'connect');
    return onConnect ? 'Powered by Macro Connect' : 'Powered by Pipedream';
  }
  return [row.account, SCOPE_LABEL[row.scope]].filter(Boolean).join(' · ');
}
