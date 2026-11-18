import type { ConnectMcpServerResponse } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { CodeExecution } from '../agent-sessions/code-execution';
import { ConnectedApp, type ConnectedTool } from './connected-app';
import { Connector } from './connector';

export type { ConnectMcpServerResponse };

/**
 * The apps the user connected for their agents (Slack, Linear, GitHub,
 * Notion, Gmail and others through Macro Connect) and the custom MCP servers
 * they added, reached from a session's code execution.
 *
 * @routing Use when the work needs a connected third-party app or MCP server (Slack, Linear, GitHub, Notion, Jira, Google Sheets, a custom MCP server): reading or changing data in it, or calling one of its tools; not Macro's own documents, email, channels or calendar.
 *
 * @agent
 * ## Connected apps
 *
 * Connected apps are reached only from an agent session's ExecuteCode program: pass the `execution` that `main` receives. `macro.connectedApps.list(execution)` returns the apps this agent was given (every app the user connected, or the agent's own selection); an app missing from it is not connected for this agent. Find a tool across every app with `macro.connectedApps.searchTools(execution, 'linear issue')`, or read one app's tools with `app.tools()`; pick one by name and description, read its `inputSchema`, then `tool.call(args)`.
 *
 * Calls run in the user's real account through Macro's server, as the account this execution acts as, and take effect at once; the program never sees a credential. In a turn someone other than the session's owner prompted, each call that uses the owner's account waits for the owner to approve it, so make few such calls and expect a long wait or a refusal. Read before writing, and never repeat a write whose outcome is unknown: check the app's state first. A result with `isError` explains itself: when it says an app is not connected, tell the user and include the connect markup it gives you in your reply verbatim, then stop.
 *
 * When an app the work needs is missing, find it with `macro.connectedApps.discover(execution, appName)` and `connector.inspect()` its advertised actions and connection status. Recommend connecting only when an advertised action supports the task; an app's name is not evidence. For a suitable unconnected app, put the inspection's `connectMarkup` in your reply verbatim and say what connecting enables. To add a remote MCP server the user gives you the URL of, use `macro.connectedApps.addServer(execution, {url, serverName})`; never guess a URL, and tell the user to sign in under Settings → Connections when its summary says so.
 *
 * ```javascript
 * export async function main({macro, execution}) {
 *   const apps = await macro.connectedApps.list(execution);
 *   const linear = apps.find((app) => app.key === 'linear');
 *   if (!linear) return {data: {error: 'Linear is not connected', available: apps.map((app) => app.name)}};
 *   const tools = await linear.tools();
 *   const search = tools.find((tool) => tool.name === 'list_issues');
 *   const result = await search.call({query: 'login bug', limit: 5});
 *   return {data: result.isError ? {error: result.content} : result.structuredContent ?? result.content};
 * }
 * ```
 */
export class ConnectedAppNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * List the apps a running code execution's session agent may use; pass the
   * `execution` given to `main`. Fails outside a running execution of the
   * session's current turn.
   *
   * @readonly
   * @openworld
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  list(execution: CodeExecution): Promise<ConnectedApp[]> {
    return ConnectedApp.list(this.client, execution);
  }

  /**
   * Find tools across every connected app the execution's agent was given,
   * by keywords matched against tool names and descriptions (e.g. `linear
   * issue`), best first, at most 20. Apps whose tools could not be read come
   * back in `unsearched`, not as an error.
   *
   * @readonly
   * @openworld
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  searchTools(
    execution: CodeExecution,
    query: string,
  ): Promise<{ matches: ConnectedTool[]; unsearched: ConnectedApp[] }> {
    return ConnectedApp.searchTools(this.client, execution, query);
  }

  /**
   * Search the catalog of apps the user could connect, by app name (e.g.
   * `Linear`, not a task description). Inspect a result before recommending
   * it: its description alone does not show what it can do.
   *
   * @readonly
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  discover(
    execution: CodeExecution,
    appName: string,
  ): Promise<{ connectors: Connector[]; moreResults: boolean }> {
    return Connector.search(this.client, execution, appName);
  }

  /**
   * Add a remote MCP server to the execution account's connections by its
   * URL: only one the user gave you, or an official URL you are sure of;
   * never guess. Most servers then need the user to sign in under
   * Settings → Connections, which the result's `summary` says. A URL the
   * user already has is left as it is.
   *
   * @write
   * @idempotent
   * @openworld
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  async addServer(
    execution: CodeExecution,
    server: { url: string; serverName: string },
  ): Promise<ConnectMcpServerResponse> {
    return unwrap(
      await this.client.agentHarness.addConnectedMcpServer({
        path: {
          session_id: execution.session().id,
          execution_id: execution.id,
        },
        body: server,
      }),
    );
  }
}
