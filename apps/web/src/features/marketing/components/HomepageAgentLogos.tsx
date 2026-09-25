import ChatGPTIcon from '@core/component/AI/assets/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { For } from 'solid-js';
import GeminiIcon from '../assets/gemini.svg';

const agents = [
  { name: 'Claude', icon: ClaudeIcon, opacity: 0.8 },
  { name: 'ChatGPT', icon: ChatGPTIcon, opacity: 0.6 },
  { name: 'Cursor', icon: CursorIcon, opacity: 0.4 },
  { name: 'Gemini', icon: GeminiIcon, opacity: 0.2 },
];

export function HomepageAgentLogos() {
  return (
    <ul
      class="m-0 flex w-fit shrink-0 list-none items-center gap-2 p-0 text-ink-muted"
      aria-label="Agents"
    >
      <For each={agents}>
        {(agent) => (
          <li class="flex items-center" style={{ opacity: agent.opacity }}>
            <agent.icon class="size-4 min-[700px]:size-5" aria-hidden="true" />
            <span class="sr-only">{agent.name}</span>
          </li>
        )}
      </For>
    </ul>
  );
}
