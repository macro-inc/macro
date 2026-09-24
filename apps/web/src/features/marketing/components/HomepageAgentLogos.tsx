import ChatGPTIcon from '@core/component/AI/assets/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { For } from 'solid-js';
import GeminiIcon from '../assets/gemini.svg';

const agents = [
  { name: 'Claude', icon: ClaudeIcon },
  { name: 'ChatGPT', icon: ChatGPTIcon },
  { name: 'Cursor', icon: CursorIcon },
  { name: 'Gemini', icon: GeminiIcon },
];

export function HomepageAgentLogos() {
  return (
    <ul
      class="mx-auto mb-4 flex w-fit list-none items-center justify-center gap-5 p-0 text-ink-extra-muted"
      aria-label="Agents"
    >
      <For each={agents}>
        {(agent) => (
          <li class="flex items-center">
            <agent.icon class="size-7" aria-hidden="true" />
            <span class="sr-only">{agent.name}</span>
          </li>
        )}
      </For>
    </ul>
  );
}
