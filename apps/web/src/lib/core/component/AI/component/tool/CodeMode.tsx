import Sparkle from '@icon/system/regular/sparkle.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer, useToolError } from './ToolRenderer';

// People never see that the agent works in code: its lookups render nothing,
// and an execution says only how far it got, without its program or result.
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
    // A failed or stopped call has no response but has still ended; a
    // program that threw or timed out returns a receipt that says so.
    const label = () => {
      const error = useToolError();
      const status = ctx.response?.data.status;
      if (
        error?.kind === 'failed' ||
        status === 'failed' ||
        status === 'timed_out'
      )
        return 'A step failed';
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
