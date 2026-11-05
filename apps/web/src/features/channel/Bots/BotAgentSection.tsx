import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { useChatV3AgentsFlag } from '../use-chat-v3-agents-flag';
import { BotFormSection } from './BotFormSection';

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
        description="Make this bot available in the model selector when starting an AI chat."
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium text-ink">
              Show in model selector
            </div>
            <p class="mt-0.5 text-xs text-ink-muted">
              Connect an agent such as Codex or Hermes to handle requests.
            </p>
          </div>
          <ToggleSwitch
            size="md"
            checked={props.checked}
            disabled={props.disabled}
            onChange={props.onChange}
            label={<span>Show in model selector</span>}
            labelClass="sr-only"
          />
        </div>

        <Show when={props.checked}>
          <div class="mt-4 border-t border-edge-muted pt-3">
            <a
              class="inline-flex h-7 items-center rounded-md border border-edge-muted px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
              href="https://docs.macro.com/AI/bring-your-own"
              target="_blank"
              rel="noopener noreferrer"
            >
              Connecting an agent? View setup guide
            </a>
          </div>
        </Show>
      </BotFormSection>
    </Show>
  );
}
