import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { useChatV3AgentsFlag } from '../use-chat-v3-agents-flag';
import { BotFormSection } from './BotFormSection';

/**
 * The "Coding agent" toggle. Hidden entirely unless the chat v3 agents flag is
 * on, so bots stay plain webhook bots for everyone else.
 */
export function BotAgentSection(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const agentsEnabled = useChatV3AgentsFlag();

  return (
    <Show when={agentsEnabled()}>
      <BotFormSection
        title="Agent"
        description="Turn this bot into a coding agent instead of a webhook responder."
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium text-ink">Agent Harness</div>
            <p class="mt-0.5 text-xs text-ink-muted">
              This bot manages an agent harness like Codex or Hermes
            </p>
          </div>
          <ToggleSwitch
            size="md"
            checked={props.checked}
            disabled={props.disabled}
            onChange={props.onChange}
            label={<span>Make this bot a coding agent</span>}
            labelClass="sr-only"
          />
        </div>
      </BotFormSection>
    </Show>
  );
}
