import {
  type SettingsTab,
  setAgentSettingsSubTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import ArrowRightIcon from '@phosphor-icons/core/assets/bold/arrow-right-bold.svg?component-solid';
import AtIcon from '@phosphor-icons/core/assets/bold/at-bold.svg?component-solid';
import PlugsConnectedIcon from '@phosphor-icons/core/assets/bold/plugs-connected-bold.svg?component-solid';
import PuzzlePieceIcon from '@phosphor-icons/core/assets/bold/puzzle-piece-bold.svg?component-solid';
import type { JSXElement } from 'solid-js';

function EmptyStateCard(props: {
  icon: JSXElement;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div class="flex gap-3 rounded-md border border-edge-muted bg-input/50 px-4 py-3">
      <div class="mt-0.5 text-accent shrink-0">{props.icon}</div>
      <div class="flex flex-col gap-1 min-w-0">
        <span class="text-sm font-medium text-ink">{props.title}</span>
        <span class="text-xs text-ink-muted leading-relaxed">
          {props.description}
        </span>
        {props.action && (
          <button
            class="mt-1 flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors cursor-pointer w-fit"
            onClick={props.action.onClick}
          >
            {props.action.label}
            <ArrowRightIcon class="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyChatState(props: { minHeight: number }) {
  const { openSettings } = useSettingsState();

  const openConnectors = () => {
    setAgentSettingsSubTab('connectors');
    openSettings('Agent' as SettingsTab);
  };

  const openMcpServer = () => {
    setAgentSettingsSubTab('mcp_server');
    openSettings('Agent' as SettingsTab);
  };

  return (
    <div
      class="w-full flex items-center justify-center"
      style={{ 'min-height': `${props.minHeight}px` }}
    >
      <div class="flex flex-col gap-3 w-full max-w-md px-4">
        <EmptyStateCard
          icon={<AtIcon class="size-4" />}
          title="@mention anything"
          description="Type @ in the chat input to attach files, documents, emails, and more as context for the AI."
        />
        <EmptyStateCard
          icon={<PlugsConnectedIcon class="size-4" />}
          title="Connect MCP servers"
          description="Give the agent access to external tools like Linear, PostHog, Datadog, and more."
          action={{ label: 'Add connectors', onClick: openConnectors }}
        />
        <EmptyStateCard
          icon={<PuzzlePieceIcon class="size-4" />}
          title="Connect your own agents"
          description="Use Macro as a tool from Claude Code, Cursor, or any MCP-compatible client."
          action={{ label: 'Set up MCP server', onClick: openMcpServer }}
        />
      </div>
    </div>
  );
}
