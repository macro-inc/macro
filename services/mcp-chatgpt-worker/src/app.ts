import { Telemetry } from '@macro-inc/observability';
import {
  buildTools,
  catalog,
  errorResult,
  handleClasses,
  InputValidators,
  OPERATION_INPUT,
  type Operation,
  OperationError,
  type OperationResult,
  runOperation,
  type Tool,
  type ToolGrouping,
} from '@macro-inc/sdk-mcp';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { match } from 'ts-pattern';
import { HOSTS, type ServiceName } from '../../../packages/sdk/src/config';
import { Macro } from '../../../packages/sdk/src/macro';
import type { Config } from './config';

/** Where MCP clients discover this resource server's authorization server. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

const SERVER_INFO = { name: 'macro', title: 'Macro', version: '1.0.0' };

function isServiceName(name: string): name is ServiceName {
  return name in HOSTS.local;
}

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  return token || undefined;
}

/**
 * The operation a tool call names, and the inputs left for it. A `method`
 * tool is its one operation; an `entity` tool names it in `op`, even when it
 * has only one.
 */
function selectOperation(
  grouping: ToolGrouping,
  tool: Tool,
  args: Readonly<Record<string, unknown>>
): { operation: Operation; input: Record<string, unknown> } | undefined {
  if (grouping === 'method') {
    const [only] = tool.operations.values();
    return only ? { operation: only, input: { ...args } } : undefined;
  }
  const { [OPERATION_INPUT]: name, ...input } = args;
  const operation =
    typeof name === 'string' ? tool.operations.get(name) : undefined;
  return operation ? { operation, input } : undefined;
}

function protectedResourceMetadata(config: Config) {
  return {
    resource: config.RESOURCE_URL,
    authorization_servers: [config.AUTHORIZATION_SERVER_URL],
    bearer_methods_supported: ['header'],
    resource_name: 'Macro',
  };
}

/** The 401 that sends an MCP client to the authorization server (RFC 9728). */
function unauthorized(config: Config) {
  const metadata = new URL(
    `${PROTECTED_RESOURCE_PATH}${new URL(config.RESOURCE_URL).pathname}`,
    config.RESOURCE_URL
  );
  return Response.json(
    { error: 'invalid_token', error_description: 'Sign in to Macro.' },
    {
      status: 401,
      headers: {
        'www-authenticate': `Bearer resource_metadata="${metadata.href}"`,
      },
    }
  );
}

/**
 * The Worker's request handler: protected-resource metadata, and the MCP
 * endpoint, a stateless Streamable HTTP server whose tools run the SDK as
 * the bearer token's user.
 */
export function createHandler(config: Config) {
  const tools = buildTools(catalog, config.TOOL_GROUPING);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const listed = tools.map(
    ({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: { ...inputSchema, type: 'object' as const },
      annotations,
    })
  );
  const validators = new InputValidators(catalog);
  const hosts = Object.fromEntries(
    Object.entries(config.MACRO_HOSTS ?? {}).filter(([name]) =>
      isServiceName(name)
    )
  );
  const mcpPath = new URL(config.RESOURCE_URL).pathname;

  async function callTool(
    tool: Tool,
    args: Readonly<Record<string, unknown>>,
    token: string
  ): Promise<OperationResult> {
    return Telemetry.span('mcp_chatgpt.tool_call', async (span) => {
      span.setAttr('mcp.tool', tool.name);
      const selected = selectOperation(config.TOOL_GROUPING, tool, args);
      if (!selected) {
        span.setAttr('mcp.outcome', 'invalid');
        return errorResult(
          new OperationError(
            'invalid',
            `Pass ${OPERATION_INPUT} as one of: ${[...tool.operations.keys()].join(', ')}`
          )
        );
      }
      span.setAttr('mcp.operation', selected.operation.name);
      span.setAttr('mcp.hint', selected.operation.hint);
      const macro = new Macro({
        token,
        env: config.MACRO_ENV,
        ...(Object.keys(hosts).length ? { hosts } : {}),
      });
      const result = await runOperation({
        operation: selected.operation,
        input: selected.input,
        macro,
        catalog,
        classes: handleClasses,
        validators,
      });
      const error = result.structuredContent.error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'ok';
      span.setAttr('mcp.outcome', code);
      return result;
    });
  }

  function mcpServer(token: string) {
    const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = toolsByName.get(request.params.name);
      if (!tool)
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool ${request.params.name}`
        );
      return callTool(tool, request.params.arguments ?? {}, token);
    });
    return server;
  }

  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(PROTECTED_RESOURCE_PATH))
      return Response.json(protectedResourceMetadata(config));
    if (pathname !== mcpPath) return new Response('Not found', { status: 404 });

    const token = bearerToken(request);
    if (!token) return unauthorized(config);

    const server = mcpServer(token);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return match(request.method)
      .with('POST', 'GET', 'DELETE', () => transport.handleRequest(request))
      .otherwise(() => new Response('Method not allowed', { status: 405 }));
  };
}
