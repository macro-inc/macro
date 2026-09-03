import type { Capability, CapabilityScope } from './model';

const SCOPE_LABEL: Record<CapabilityScope, string> = {
  personal: 'Personal',
  shared: 'Shared',
};

export function capabilityFacts(
  row: Pick<Capability, 'account' | 'scope' | 'mechanism'>
): string {
  if (row.mechanism === 'pipedream') return 'Powered by Pipedream';
  return [row.account, SCOPE_LABEL[row.scope]].filter(Boolean).join(' · ');
}
