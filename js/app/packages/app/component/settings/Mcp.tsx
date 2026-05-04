import { Panel } from '@ui';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';

export function Mcp() {
  return (
    <div
      class="flex-1 overflow-y-auto py-2 px-4"
      style="scrollbar-width: none;"
    >
      <div class="max-w-2xl w-full mx-auto">
        <Panel depth={2}>
          <div class="flex flex-col gap-4 p-6 text-ink">
            <p class="text-sm text-ink-muted">
              Use Macro with your favorite AI chat client or code editor via
              MCP.
            </p>
            <McpSetupCards class="max-w-none" />
          </div>
        </Panel>
      </div>
    </div>
  );
}
