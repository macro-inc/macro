import Sparkle from '@icon/system/regular/sparkle.svg';
import { BaseTool } from './BaseTool';
import {
  createToolRenderer,
  type ToolEnding,
  useToolError,
} from './ToolRenderer';

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

/**
 * Nothing names what a code run does, so it says only how far it got. A
 * failed or stopped call has no receipt but has still ended; a program that
 * threw, timed out or was cancelled returns a receipt that says so.
 */
export function codeRunLabel(receipt: unknown, ending: ToolEnding | undefined) {
  const status =
    typeof receipt === 'object' && receipt !== null && 'status' in receipt
      ? receipt.status
      : undefined;
  if (
    ending?.kind === 'failed' ||
    status === 'failed' ||
    status === 'timed_out'
  )
    return 'A step failed';
  if (ending?.kind === 'stopped' || status === 'cancelled')
    return 'Step interrupted';
  if (receipt !== undefined) return 'Finished a step';
  return 'Working on it';
}

/** Fallback for hosts without session records; agent sessions use CodeExecutionPart. */
export const executeCodeHandler = createToolRenderer({
  name: 'ExecuteCode',
  render: (ctx) => {
    return (
      <BaseTool icon={Sparkle} renderContext={ctx.renderContext} type="call">
        <span class="flex-1">
          {codeRunLabel(ctx.response?.data, useToolError())}
        </span>
      </BaseTool>
    );
  },
});
