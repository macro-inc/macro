import Wrench from '@icon/system/regular/wrench.svg';
import { BaseTool } from './BaseTool';
import type { RenderContext } from './ToolRenderer';

/**
 * A saved call of a tool this build has no schema for, such as one deleted
 * without a retired schema: shown by name instead of hidden.
 */
export function UnknownToolCall(props: {
  name: string;
  renderContext: RenderContext;
}) {
  return (
    <BaseTool
      icon={Wrench}
      renderContext={props.renderContext.renderContext}
      type="call"
    >
      <span class="min-w-0 truncate">{props.name}</span>
    </BaseTool>
  );
}
