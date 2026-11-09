import { t } from '@app/lib/i18n';
import type { AgentWithHarnessId } from '@queries/agents/agents';
import { For, Show } from 'solid-js';

/** The agents bound to a computer's harness, by name and handle. */
export function ComputerAgents(props: {
  agents: readonly AgentWithHarnessId[];
}) {
  return (
    <Show when={props.agents.length > 0}>
      <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{t('computers.agents')}</span>
        <For each={props.agents}>
          {(agent) => (
            <span class="inline-flex items-center gap-1">
              <span class="text-ink">{agent.bot.name}</span>
              <span class="text-ink-extra-muted">@{agent.bot.handle}</span>
            </span>
          )}
        </For>
      </span>
    </Show>
  );
}
