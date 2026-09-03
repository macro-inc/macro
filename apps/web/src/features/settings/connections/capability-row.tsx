import type { JSX } from 'solid-js';
import { IntegrationRow } from '../primitives';
import type { Capability, CapabilityScope } from './model';

const SCOPE_LABEL: Record<CapabilityScope, string> = {
  personal: 'Personal',
  shared: 'Shared',
  team: 'Team',
};

export function capabilityFacts(
  row: Pick<Capability, 'account' | 'scope' | 'mechanism'>
): string {
  if (row.mechanism === 'pipedream') return 'Powered by Pipedream';
  return [row.account, SCOPE_LABEL[row.scope]].filter(Boolean).join(' · ');
}

export function CapabilityRow(props: {
  title: string;
  outcome: string;
  facts?: JSX.Element;
  icon?: JSX.Element;
  /** Soften the title when the capability is disabled. */
  muted?: boolean;
  children?: JSX.Element;
}) {
  return (
    <IntegrationRow
      icon={props.icon}
      title={props.title}
      description={props.outcome}
      facts={props.facts}
      muted={props.muted}
    >
      {props.children}
    </IntegrationRow>
  );
}
