import type { RosterAgent } from '@app/features/agents-view/core/roster';
import { t } from '@app/lib/i18n';
import PlayIcon from '@icon/system/fill/play-fill.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { AUTO_AGENT_CHOICE } from '../core/prompt-agents';

/** The agent picker and Run button in a prompt block's header. */
export function PromptRunControls(props: {
  agents: readonly RosterAgent[];
  /** The chosen agent id, or `AUTO_AGENT_CHOICE`. */
  choice: string;
  choiceLabel: string;
  autoAvailable: boolean;
  running: boolean;
  onChoose: (choice: string) => void;
  onRun: () => void;
}) {
  const chatAgents = () =>
    props.agents.filter((agent) => agent.kind === 'agent');
  const coders = () => props.agents.filter((agent) => agent.kind === 'coder');
  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <Dropdown>
        <Dropdown.Trigger
          size="sm"
          class="min-w-0 max-w-40"
          aria-label={t('promptBlock.agent')}
          title={props.choiceLabel}
        >
          <span class="truncate">{props.choiceLabel}</span>
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-52 max-w-80">
          <Dropdown.RadioGroup value={props.choice} onChange={props.onChoose}>
            <Show when={props.autoAvailable}>
              <Dropdown.Group>
                <AgentItem
                  value={AUTO_AGENT_CHOICE}
                  label={t('promptBlock.auto')}
                  description={t('promptBlock.autoDescription')}
                />
              </Dropdown.Group>
            </Show>
            <Show when={chatAgents().length > 0}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>
                  {t('promptBlock.agents')}
                </Dropdown.GroupLabel>
                <For each={chatAgents()}>
                  {(agent) => <AgentItem value={agent.id} label={agent.name} />}
                </For>
              </Dropdown.Group>
            </Show>
            <Show when={coders().length > 0}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>
                  {t('promptBlock.codingAgents')}
                </Dropdown.GroupLabel>
                <For each={coders()}>
                  {(agent) => <AgentItem value={agent.id} label={agent.name} />}
                </For>
              </Dropdown.Group>
            </Show>
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown>
      <Button
        size="sm"
        variant="primary"
        aria-label={t('promptBlock.runPrompt')}
        loading={props.running}
        onClick={props.onRun}
      >
        <PlayIcon class="size-3 shrink-0" />
        {t('promptBlock.run')}
      </Button>
    </div>
  );
}

function AgentItem(props: {
  value: string;
  label: string;
  description?: string;
}) {
  return (
    <Dropdown.RadioItem value={props.value} closeOnSelect>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate">{props.label}</span>
        <Show when={props.description}>
          <span class="text-xs text-ink-muted">{props.description}</span>
        </Show>
      </span>
      <Dropdown.ItemIndicator>
        <CheckIcon class="size-3.5 text-accent" />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}
