import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { SettingsPage } from './primitives';

/**
 * The "MCP server" tab: setup instructions for pointing other agents and MCP
 * clients (Claude Code, Codex, IDEs, ...) at Macro's own MCP server. Managing
 * Macro's outbound connectors lives on the Connections tab (see
 * `Integrations.tsx`).
 */
export function Agent() {
  return (
    <SettingsPage
      title="Macro MCP server"
      description="Connect other agents and tools to your Macro workspace."
    >
      <McpSetupCards class="max-w-none" />
    </SettingsPage>
  );
}
