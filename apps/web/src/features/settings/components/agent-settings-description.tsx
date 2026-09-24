import {
  AGENTS_DESCRIPTION,
  RUNTIMES_DESCRIPTION,
} from '@core/constant/agentCopy';

/** Shared explanation of agents or runtimes, matching the current tab. */
export function AgentSettingsDescription(props: {
  section: 'agents' | 'runtimes';
}) {
  return (
    <span class="block leading-relaxed">
      {props.section === 'agents' ? AGENTS_DESCRIPTION : RUNTIMES_DESCRIPTION}
    </span>
  );
}
