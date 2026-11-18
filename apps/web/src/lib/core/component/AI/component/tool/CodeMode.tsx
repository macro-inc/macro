import Sparkle from '@icon/system/regular/sparkle.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer, useToolError } from './ToolRenderer';

// People never see that the agent works in code: its lookups render nothing,
// and an execution reads as work in the workspace, without its program or result.
// These cover the chat host's RenderTool; agent sessions skip lookups in
// ToolCallPart (`isCodeModeSupportCall`) and render code runs in CodeExecutionPart.

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
  render: (ctx) => {
    // Nothing names what the run does, so the row says only how far it got.
    // A failed or stopped run has no response but has still ended.
    const label = () => {
      const error = useToolError();
      if (error?.kind === 'failed') return 'A step failed';
      if (ctx.response !== undefined || error) return 'Finished a step';
      return 'Working on it';
    };
    return (
      <BaseTool icon={Sparkle} renderContext={ctx.renderContext} type="call">
        <span class="flex-1">{label()}</span>
      </BaseTool>
    );
  },
});
