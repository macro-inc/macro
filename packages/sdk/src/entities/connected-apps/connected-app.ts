import type {
  ConnectedAppKind,
  ConnectedApp as ConnectedAppRecord,
  ConnectedTool as ConnectedToolRecord,
  ConnectedToolResult as ConnectedToolResultRecord,
} from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { CodeExecution } from '../agent-sessions/code-execution';

export type { ConnectedAppKind };

/** A connected tool's answer, MCP's `CallToolResult`. */
export type ConnectedToolResult = {
  /** The tool failed or could not run; `content` says why. */
  isError: boolean;
  /** MCP content blocks, e.g. `{type: 'text', text}`. */
  content: Array<Record<string, unknown>>;
  /** Structured output, for tools that declare an output schema. */
  structuredContent?: Record<string, unknown>;
};

/**
 * An app the session's agent was given: one the user connected through
 * Macro Connect (Slack, Linear, GitHub, Notion, Gmail, ...) or a custom MCP
 * server they added. Read its tools, then call one.
 */
export class ConnectedApp {
  private constructor(
    private readonly client: MacroClient,
    /** The running execution this app is reached through. */
    readonly execution: CodeExecution,
    /** `app` for a connected app, `custom` for a custom MCP server. */
    readonly kind: ConnectedAppKind,
    /** The app's slug, e.g. `slack`, or the custom server's key. */
    readonly key: string,
    /** Display name, e.g. `Slack`. */
    readonly name: string,
  ) {}

  /** The apps `execution`'s session agent was given. */
  static async list(
    client: MacroClient,
    execution: CodeExecution,
  ): Promise<ConnectedApp[]> {
    const records = unwrap(
      await client.agentHarness.listExecutionConnectedApps({
        path: {
          session_id: execution.session().id,
          execution_id: execution.id,
        },
      }),
    );
    return records.map((record: ConnectedAppRecord) =>
      ConnectedApp.fromRecord(client, execution, record),
    );
  }

  /** @internal A handle for an app record the harness answered. */
  static fromRecord(
    client: MacroClient,
    execution: CodeExecution,
    record: ConnectedAppRecord,
  ): ConnectedApp {
    return new ConnectedApp(
      client,
      execution,
      record.kind,
      record.key,
      record.name,
    );
  }

  /**
   * Find tools across every app the execution's agent was given, by
   * keywords matched against tool names and descriptions, best first (at
   * most 20). `unsearched` lists apps whose tools could not be read.
   */
  static async searchTools(
    client: MacroClient,
    execution: CodeExecution,
    query: string,
  ): Promise<{ matches: ConnectedTool[]; unsearched: ConnectedApp[] }> {
    const found = unwrap(
      await client.agentHarness.searchConnectedAppTools({
        path: {
          session_id: execution.session().id,
          execution_id: execution.id,
        },
        query: { query },
      }),
    );
    return {
      matches: found.matches.map((match) =>
        ConnectedTool.fromRecord(
          client,
          ConnectedApp.fromRecord(client, execution, match.app),
          match.tool,
        ),
      ),
      unsearched: found.unsearched.map((record) =>
        ConnectedApp.fromRecord(client, execution, record),
      ),
    };
  }

  /**
   * The tools this app serves, with each one's description and argument
   * schema. Read a tool's `inputSchema` before calling it.
   *
   * @readonly
   * @openworld
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  async tools(): Promise<ConnectedTool[]> {
    const records = unwrap(
      await this.client.agentHarness.listConnectedAppTools({
        path: this.path(),
      }),
    );
    return records.map((record: ConnectedToolRecord) =>
      ConnectedTool.fromRecord(this.client, this, record),
    );
  }

  /**
   * @internal The harness route that names this app.
   *
   * @readonly
   * @mcp-exclude Internal route helper.
   */
  path() {
    return {
      session_id: this.execution.session().id,
      execution_id: this.execution.id,
      kind: this.kind,
      key: this.key,
    };
  }

  /** Serialize identity only. */
  toJSON() {
    return { kind: this.kind, key: this.key, name: this.name };
  }
}

/** One tool a connected app serves. */
export class ConnectedTool {
  /** @internal */
  constructor(
    private readonly client: MacroClient,
    /** The app serving this tool. */
    readonly app: ConnectedApp,
    /** The tool's name on its server. */
    readonly name: string,
    /** What the server says the tool does. */
    readonly description: string | undefined,
    /** JSON Schema for the tool's arguments. */
    readonly inputSchema: Record<string, unknown>,
  ) {}

  /** @internal A handle for a tool record the harness answered. */
  static fromRecord(
    client: MacroClient,
    app: ConnectedApp,
    record: ConnectedToolRecord,
  ): ConnectedTool {
    return new ConnectedTool(
      client,
      app,
      record.name,
      record.description ?? undefined,
      record.inputSchema,
    );
  }

  /**
   * Call the tool as the execution's account, with arguments matching
   * `inputSchema`. Writes take effect immediately, in the user's real
   * account. In a turn someone other than the session's owner prompted, a
   * call as the owner waits for the owner to approve it, and a declined or
   * unanswered call comes back with `isError`. Check `isError` on the result: an app that is not connected,
   * or whose connection expired, answers with `isError` and text telling you
   * what to say to the user, including any connect markup to put in your
   * reply verbatim.
   *
   * @destructive
   * @openworld
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  async call(args: Record<string, unknown> = {}): Promise<ConnectedToolResult> {
    const result: ConnectedToolResultRecord = unwrap(
      await this.client.agentHarness.callConnectedAppTool({
        path: this.app.path(),
        body: { tool: this.name, arguments: args },
      }),
    );
    return {
      isError: result.isError,
      content: result.content,
      structuredContent: result.structuredContent ?? undefined,
    };
  }

  /** Serialize the tool's description, not its client. */
  toJSON() {
    return {
      app: this.app.toJSON(),
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
    };
  }
}
