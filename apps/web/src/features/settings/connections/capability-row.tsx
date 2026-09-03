import type { JSX } from 'solid-js';
import { StatusDot } from '../integration-ui';
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
  const parts = [row.account, SCOPE_LABEL[row.scope]];
  if (row.mechanism === 'pipedream') parts.push('Powered by Pipedream');
  return parts.filter(Boolean).join(' · ');
}

export function CapabilityRow(props: {
  title: string;
  outcome: string;
  facts?: JSX.Element;
  status?: Capability['status'];
  icon?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <IntegrationRow
      icon={props.icon}
      title={props.title}
      status={
        props.status === 'off' ? (
          <StatusDot state="off" label="Off" />
        ) : undefined
      }
      description={props.outcome}
      facts={props.facts}
    >
      {props.children}
    </IntegrationRow>
  );
}
