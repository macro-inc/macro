import { Panel } from '@ui';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';

export function Mcp() {
  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        <Panel depth={2} class="h-full overflow-hidden text-ink">
          <Panel.Header class="px-6">
            <div class="text-sm font-semibold">MCP Setup</div>
          </Panel.Header>

          <Panel.Body scroll>
            <div class="px-6 py-4">
              <McpSetupCards class="max-w-none" />
            </div>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
