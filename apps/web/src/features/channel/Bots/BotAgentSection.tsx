import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { BotFormSection } from './BotFormSection';

export function BotAgentSection(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <BotFormSection
      title="Agent"
      description="Make this bot available in the model selector and respond to mentions."
    >
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="text-sm font-medium text-ink">Enable AI agent</div>
          <p class="mt-0.5 text-xs text-ink-muted">
            Use a chat agent or connect your own machine to handle requests.
          </p>
        </div>
        <ToggleSwitch
          size="md"
          checked={props.checked}
          disabled={props.disabled}
          onChange={props.onChange}
          label={<span>Enable AI agent</span>}
          labelClass="sr-only"
        />
      </div>

      <Show when={props.checked}>
        <div class="mt-4 border-t border-edge-muted pt-3">
          <a
            class="inline-flex h-7 items-center rounded-md border border-edge-muted px-2 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
            href="https://macro.com/docs/AI/bring-your-own"
            target="_blank"
            rel="noopener noreferrer"
          >
            Connecting an agent? View setup guide
          </a>
        </div>
      </Show>
    </BotFormSection>
  );
}
