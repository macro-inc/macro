import { tool } from 'ai';
import { z } from 'zod';

/**
 * A tool the agent calls to bail out when it cannot proceed. Pass only the
 * trigger condition in `whenToUse`; this factory owns the shared framing.
 *
 * @param whenToUse - the situation that should trigger the call
 * @param callMeAgain - if the block is resolvable by re-invoking with more info,
 *   the message is framed as a directive to the caller; otherwise it is a one-line reason
 */
export function createImBlockedTool(whenToUse: string, callMeAgain: boolean) {
  const guidance = callMeAgain
    ? ' Your message must be a directive telling the caller to invoke you again with the missing information.'
    : ' State what stopped you in one line.';
  return tool({
    description: `${whenToUse}${guidance} This ends your turn.`,
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
