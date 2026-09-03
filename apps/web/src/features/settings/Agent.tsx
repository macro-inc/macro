import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { useSettingsState } from '@core/constant/SettingsState';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CpuIcon from '@phosphor/cpu.svg';
import { showConnectionsDiscover } from './connections/view-state';
import { IntegrationRow, SettingsCard, SettingsPage } from './primitives';

/**
 * The "MCP server" tab: setup instructions for pointing other agents and MCP
 * clients (Claude Code, Codex, IDEs, ...) at Macro's own MCP server. Inbound
 * connectors live on Connections.
 */
export function Agent() {
  const { selectTab } = useSettingsState();

  const openConnectionsDiscover = () => {
    showConnectionsDiscover();
    selectTab('Connected');
  };

  return (
    <SettingsPage
      title="Macro MCP server"
      description="Point Claude Code, Codex, ChatGPT, or your IDE at this workspace."
    >
      <SettingsCard>
        <button
          type="button"
          class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6"
          onClick={openConnectionsDiscover}
        >
          <IntegrationRow
            icon={<CpuIcon />}
            title="Looking to connect Macro to your favorite tools?"
            description="Those live in Connections. This page is for other agents."
          >
            <CaretRightIcon class="size-4 text-ink-extra-muted" />
          </IntegrationRow>
        </button>
      </SettingsCard>
      <McpSetupCards class="max-w-none" />
    </SettingsPage>
  );
}
