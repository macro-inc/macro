import ChatIcon from '@phosphor/chat-circle.svg';
import CodeIcon from '@phosphor/code.svg';
import type { AgentsMode } from '../core/mode';

/** Select what kind of agent a new conversation runs. */
export function ComposerModeSwitch(props: {
  mode: AgentsMode;
  onChange: (mode: AgentsMode) => void;
}) {
  return (
    <div
      class="flex shrink-0 items-center rounded-full bg-ink/5 p-0.5"
      role="group"
      aria-label="Conversation mode"
    >
      <button
        type="button"
        aria-label="Chat mode"
        aria-pressed={props.mode === 'chat'}
        class="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-ink-muted transition-colors hover:text-ink aria-pressed:bg-ink/10 aria-pressed:text-ink"
        onClick={() => props.onChange('chat')}
      >
        <ChatIcon class="size-4" />
        Chat
      </button>
      <button
        type="button"
        aria-label="Code mode"
        aria-pressed={props.mode === 'code'}
        class="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-ink-muted transition-colors hover:text-ink aria-pressed:bg-ink/10 aria-pressed:text-ink"
        onClick={() => props.onChange('code')}
      >
        <CodeIcon class="size-4" />
        Code
      </button>
    </div>
  );
}
