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
import {
  keyBytes,
  PersonTokenError,
  type PersonTokens,
  personTokenKey,
} from './person-tokens';

/** Where MCP clients discover this resource server's authorization server. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** Where OpenAI checks that the app's MCP server is on a domain it owns. */
export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

const SERVER_INFO = { name: 'macro', title: 'Macro', version: '1.0.0' };

/** The tool that turns person tokens back into names and emails. */
export const PEOPLE_TOOL = 'people_read';

const MAX_PEOPLE = 20;

const PEOPLE_LISTED = {
  name: PEOPLE_TOOL,
  title: 'Look up people',
  description:
    "Other tools return people as tokens (person_u_… for a Macro user, person_e_… for an email address) instead of their user ids and emails. Pass those tokens back as they are wherever a tool takes a user id or email (assigning, mentioning, sharing, filtering by person). Call this tool only when the user asks for someone's contact details or needs their email address: it returns each token's name and email.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      tokens: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_PEOPLE,
        description: 'Person tokens from earlier results.',
      },
    },
    required: ['tokens'],
    additionalProperties: false,
  },
  annotations: {
    title: 'Look up people',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Viewer ids by a hash of the bearer, so a person token costs one lookup per token, not per call. */
const VIEWERS = new Map<string, Promise<string>>();
const MAX_VIEWERS = 1000;

async function bearerKey(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

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
  const personKey = personTokenKey(
    (config.PERSON_TOKEN_KEY && keyBytes(config.PERSON_TOKEN_KEY)) ||
      crypto.getRandomValues(new Uint8Array(32))
  );

  function macroFor(token: string) {
    return new Macro({
      token,
      env: config.MACRO_ENV,
      ...(Object.keys(hosts).length ? { hosts } : {}),
    });
  }

  /** Person tokens for the bearer's user, who is looked up only when needed. */
  function personTokens(token: string): PersonTokens {
    return personKey(async () => {
      const key = await bearerKey(token);
      let viewer = VIEWERS.get(key);
      if (!viewer) {
        if (VIEWERS.size >= MAX_VIEWERS) VIEWERS.clear();
        viewer = macroFor(token).myPrincipalId();
        viewer.catch(() => VIEWERS.delete(key));
        VIEWERS.set(key, viewer);
      }
      return viewer;
    });
  }

  /** `people_read`: each token's name and email, the only output that carries them. */
  async function lookUpPeople(
    args: Readonly<Record<string, unknown>>,
    token: string
  ): Promise<OperationResult> {
    const tokens = args.tokens;
    if (
      !Array.isArray(tokens) ||
      !tokens.length ||
      tokens.length > MAX_PEOPLE ||
      !tokens.every((item) => typeof item === 'string')
    )
      return errorResult(
        new OperationError(
          'invalid',
          `tokens: pass 1 to ${MAX_PEOPLE} person tokens`
        )
      );
    const people = personTokens(token);
    const macro = macroFor(token);
    const found = await Promise.all(
      tokens.map(async (personToken: string) => {
        try {
          const identifier = await people.open(personToken);
          const email = identifier.replace(/^macro\|/, '');
          if (identifier === email) return { token: personToken, email };
          const name = await macro.users
            .byId(identifier)
            .name()
            .catch(() => undefined);
          return { token: personToken, ...(name ? { name } : {}), email };
        } catch (error) {
          if (error instanceof PersonTokenError)
            return { token: personToken, error: error.message };
          throw error;
        }
      })
    );
    return {
      content: [
        {
          type: 'text',
          text: found
            .map((person) =>
              'email' in person
                ? `${person.token}: ${'name' in person ? `${person.name} <${person.email}>` : person.email}`
                : `${person.token}: ${person.error}`
            )
            .join('\n'),
        },
      ],
      structuredContent: { people: found },
    };
  }

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
      const people = personTokens(token);
      let input: Record<string, unknown>;
      try {
        const revealed = await people.reveal(selected.input);
        input =
          typeof revealed === 'object' && revealed !== null
            ? { ...revealed }
            : {};
      } catch (error) {
        span.setAttr('mcp.outcome', 'invalid');
        if (error instanceof PersonTokenError)
          return errorResult(new OperationError('invalid', error.message));
        throw error;
      }
      const raw = await runOperation({
        operation: selected.operation,
        input,
        macro: macroFor(token),
        catalog,
        classes: handleClasses,
        validators,
      });
      // ChatGPT sees people as tokens, never their user ids or emails.
      let result: OperationResult;
      try {
        result = (await people.conceal(raw)) as OperationResult;
      } catch {
        span.setAttr('mcp.outcome', 'internal');
        return errorResult(
          new OperationError(
            'internal',
            "Couldn't protect people in the result."
          )
        );
      }
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
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [...listed, PEOPLE_LISTED],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === PEOPLE_TOOL)
        return Telemetry.span('mcp_chatgpt.tool_call', async (span) => {
          span.setAttr('mcp.tool', PEOPLE_TOOL);
          return lookUpPeople(request.params.arguments ?? {}, token);
        });
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
    if (pathname === OPENAI_APPS_CHALLENGE_PATH)
      return config.OPENAI_APPS_CHALLENGE
        ? new Response(config.OPENAI_APPS_CHALLENGE, {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        : new Response('Not found', { status: 404 });
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
