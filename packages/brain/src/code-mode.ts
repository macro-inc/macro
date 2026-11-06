// Macro's public MCP is the source of tool schemas, descriptions and SDK docs.
// Only this brain-process transport holds the agent's user API key.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { API_KEY_HEADER } from './macro.ts';
import type { BrainTool } from './runner.ts';
import { tracedFetch, withSpan } from './telemetry.ts';

const names = ['ExecuteCode', 'DescribeCodeTools', 'ReadCodeDocs'];
export type CodeModeConnection = {
  tools: BrainTool[];
  close(): Promise<void>;
};
export class MacroCodeMode {
  readonly #url: URL;
  readonly #key: string;
  constructor(url: string, apiKey: string) {
    this.#url = new URL(url);
    this.#key = apiKey;
  }
  async connect(signal: AbortSignal): Promise<CodeModeConnection> {
    const client = new Client({ name: 'macro-brain', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(this.#url, {
      requestInit: {
        headers: { [API_KEY_HEADER]: this.#key },
        redirect: 'error',
      },
      fetch: tracedFetch(fetch),
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    const close = () => client.close();
    const abort = () => {
      void close().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const definitions = await withSpan(
        'brain.code_mode.discover',
        {},
        async () => {
          await client.connect(transport, { signal, timeout: 30000 });
          const definitions: Tool[] = [];
          let cursor: string | undefined;
          do {
            const page = await client.listTools(
              { cursor },
              { signal, timeout: 30000 }
            );
            definitions.push(...page.tools);
            cursor = page.nextCursor;
          } while (cursor);
          return definitions;
        }
      );
      const tools = names.map((name) => {
        const definition = definitions.find((entry) => entry.name === name);
        if (!definition?.description)
          throw new Error(`Macro code mode unavailable: missing ${name}`);
        const schema = z.fromJSONSchema({
          ...definition.inputSchema,
          properties: Object.fromEntries(
            Object.entries(definition.inputSchema.properties ?? {}).map(
              ([key, value]) => [key, { ...value }]
            )
          ),
        });
        if (!(schema instanceof z.ZodObject))
          throw new Error(`Macro code mode has invalid schema: ${name}`);
        return tool(
          name,
          definition.description,
          schema.shape,
          async (args) => {
            try {
              return CallToolResultSchema.parse(
                await withSpan(
                  'brain.code_mode.call',
                  { 'tool.name': name },
                  () =>
                    client.callTool(
                      { name, arguments: args },
                      CallToolResultSchema,
                      { signal, timeout: 180000 }
                    )
                )
              );
            } catch {
              // Transport/provider errors can contain request details. Never relay them.
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text:
                      name === 'ExecuteCode'
                        ? 'Macro ExecuteCode request failed; writes may already have completed. Check state before retrying.'
                        : `Macro ${name} request failed`,
                  },
                ],
              };
            }
          }
        );
      });
      return {
        tools,
        async close() {
          signal.removeEventListener('abort', abort);
          await close();
        },
      };
    } catch {
      signal.removeEventListener('abort', abort);
      await close().catch(() => {});
      throw new Error(
        'Macro code mode unavailable: ExecuteCode, DescribeCodeTools and ReadCodeDocs are required'
      );
    }
  }
}
