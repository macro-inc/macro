import Sparkle from '@icon/system/regular/sparkle.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

// People never see that the agent works in code: its lookups render nothing,
// and an execution reads as work in the workspace, without its program or result.

export const describeCodeToolsHandler = createToolRenderer({
  name: 'DescribeCodeTools',
  render: () => null,
});

export const readCodeDocsHandler = createToolRenderer({
  name: 'ReadCodeDocs',
  render: () => null,
});

/** Fallback for hosts without session records; agent sessions use CodeExecutionPart. */
export const executeCodeHandler = createToolRenderer({
  name: 'ExecuteCode',
  render: (ctx) => (
    <BaseTool icon={Sparkle} renderContext={ctx.renderContext} type="call">
      <span class="flex-1">
        {ctx.response
          ? 'Worked in your workspace'
          : 'Working in your workspace'}
      </span>
    </BaseTool>
  ),
});
