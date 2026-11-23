import Plug from '@phosphor-icons/core/regular/plug.svg';
import type { ConnectorStatus } from '@service-cognition/generated/tools/types';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import { DetailPanel } from './Bots';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

function statusLabel(status: ConnectorStatus): string {
  return match(status)
    .with('connected', () => 'Connected')
    .with('disabled', () => 'Disabled')
    .with('needsReauth', () => 'Needs reconnecting')
    .with('notConnected', () => 'Not signed in')
    .exhaustive(() => 'Unknown');
}

export const connectMcpServerHandler = createToolRenderer({
  name: 'ConnectMcpServer',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;

    return (
      <BaseTool
        icon={Plug}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <DetailPanel
              summary={response()!.summary}
              details={[
                { label: 'URL', value: response()!.url },
                { label: 'Status', value: statusLabel(response()!.status) },
                { label: 'Enabled', value: response()!.enabled ? 'Yes' : 'No' },
              ]}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>
            {ctx.response ? 'Connected MCP server' : 'Connect MCP server'}
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={response()?.serverName}
          />
        </div>
      </BaseTool>
    );
  },
});
