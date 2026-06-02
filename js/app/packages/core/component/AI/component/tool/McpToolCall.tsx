import Plug from '@phosphor-icons/core/regular/plug.svg';
import { getMcpServerIcon, type SvgIcon } from '../../constant/mcpServers';
import { BaseTool } from './BaseTool';
import type { RenderContext } from './ToolRenderer';

export function McpToolCall(props: {
  name: string;
  service: string;
  display_name?: string;
  isComplete: boolean;
  renderContext: RenderContext;
}) {
  const Icon = (): SvgIcon =>
    getMcpServerIcon(props.service) ?? (Plug as SvgIcon);

  return (
    <BaseTool
      icon={Icon()}
      renderContext={props.renderContext.renderContext}
      type="call"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span class="shrink-0 text-ink-muted">{props.service}</span>
        <span class="text-ink-extra-muted">/</span>
        <span class="min-w-0 truncate">{props.display_name ?? props.name}</span>
      </div>
    </BaseTool>
  );
}
