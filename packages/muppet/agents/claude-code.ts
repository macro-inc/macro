import {
  createSdkMcpServer,
  type query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Agent } from '../core/agent.ts';

const server = 'muppet';

/**
 * Claude Code as an agent, through the Claude Agent SDK. Each wake starts a
 * session with the request and its event as the prompt, and the system
 * prompt appended to Claude Code's own, and gives it the code-mode tools, ExecuteCode and DescribeCapabilities.
 */
export const claudeCode = ({
  query: run,
}: {
  /** The SDK's `query`, injected. */
  readonly query: typeof query;
}): Agent => ({
  wake: async ({ request, systemPrompt, event, state }) => {
    const capabilities = createSdkMcpServer({
      name: server,
      tools: [
        tool(
          'ExecuteCode',
          'Type-check a TypeScript module that exports `async function main({ context, log })`, then run it inside your running process, and get back what main returned and everything it passed to log, or the type errors that kept it from running. Use it to use your capabilities.',
          { source: z.string() },
          async ({ source }) => {
            const executed = await state.code.execute(source);
            return {
              content: [{ type: 'text', text: JSON.stringify(executed) }],
              isError: executed.kind === 'failed',
            };
          }
        ),
        tool(
          'DescribeCapabilities',
          'Read the full docs of capabilities in your catalog, several at once.',
          { names: z.array(z.string()) },
          async ({ names }) => ({
            content: [{ type: 'text', text: await state.code.describe(names) }],
          })
        ),
      ],
    });

    const prompt = [
      request,
      `This was prompted by a "${event.name}" event:`,
      JSON.stringify(event.payload, null, 2),
    ].join('\n\n');

    for await (const message of run({
      prompt,
      options: {
        mcpServers: { [server]: capabilities },
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt,
        },
        // The agent runs unattended and may do anything, so nothing waits on approval.
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (message.type === 'result')
        return message.subtype === 'success'
          ? { kind: 'done', reply: message.result }
          : { kind: 'failed', error: message.subtype };
    }
    return { kind: 'failed', error: 'session ended without a result' };
  },
});
