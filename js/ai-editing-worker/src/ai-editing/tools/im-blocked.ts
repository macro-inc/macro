import { tool } from 'ai';
import { z } from 'zod';

/**
 * @param whenToUse - injected into the tool description; tell the model when to call it
 * @param callMeAgain - whether the caller can re-invoke with more info to resolve the block
 */
export function createImBlockedTool(whenToUse: string, callMeAgain: boolean) {
  const retryHint = callMeAgain
    ? ' The caller will invoke you again with the missing information.'
    : '';
  return tool({
    description: `${whenToUse}${retryHint}`,
    inputSchema: z.object({
      message: z
        .string()
        .describe(
          callMeAgain
            ? 'directive to the caller: what to invoke you again with'
            : 'what stopped you, in one line'
        ),
    }),
    execute: async () => 'acknowledged',
  });
}
