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
 * Calls run in the user's real account through Macro's server, as the account this execution acts as, and take effect at once; the program never sees a credential. In a turn someone other than the session's owner prompted, each call that uses the owner's account waits for the owner to approve it, so make few such calls and expect a long wait or a refusal. Read before writing, and never repeat a write whose outcome is unknown: check the app's state first. A result with `isError` explains itself: when it says an app is not connected, present a connect card for that app (below) instead of the markup it gives you, tell the user to connect it, then stop.
 *
 * Each account's calls to one app share a budget across its running programs on the same Macro server: a few run at once, paced, and the rest queue. Narrow first with the app's search or list tools and their own limits and filters (e.g. open PRs updated this week), then call per item only for the few items you need, in small batches; never `Promise.all` a call per item over a whole list. A call the app keeps refusing with HTTP 429 is retried after its `Retry-After`; one still refused throws a rate-limit error and did not run, so stop and report partial results rather than retrying in a loop.
 *
 * When an app the work needs is missing, find it with `macro.connectedApps.discover(execution, appName)` and `connector.inspect()` its advertised actions and connection status. Recommend connecting only when an advertised action supports the task; an app's name is not evidence. For a suitable unconnected app, present a connect card, `execution.views.present({widgets: [{type: 'connect', name: connector.name, target: {kind: 'app', appSlug: connector.slug}}]})`, instead of the inspection's `connectMarkup`, and say what connecting enables. Then end the turn without asking in text to connect: the card asks, shows Connected once they have, and the session continues by itself. To add a remote MCP server the user gives you the URL of, use `macro.connectedApps.addServer(execution, {url, serverName})`; never guess a URL. When its result is not `authenticated`, present a connect card with `target: {kind: 'server', url}`, whose Connect button signs the user in, and say only to reply once they have used it: a server sign-in does not continue the session by itself, and `authenticated` only says no sign-in is stored, so a server that needs none never shows Connected and works as it is.
 *
 * ```typescript
 * export async function main({macro, execution}: CodeContext) {
 *   const apps = await macro.connectedApps.list(execution);
 *   const linear = apps.find((app) => app.key === 'linear');
 *   if (!linear) return {data: {error: 'Linear is not connected', available: apps.map((app) => app.name)}};
 *   const tools = await linear.tools();
 *   const search = tools.find((tool) => tool.name === 'list_issues');
 *   if (!search) return {data: {error: 'Linear has no list_issues tool'}};
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
   * never guess. When the result is not `authenticated`, present a connect
   * card with a server target for the URL so the user can sign in, and ask
   * them to reply once they have used it: `authenticated` only says no
   * sign-in is stored, and a server that needs none works without one. A
   * URL the user already has is left as it is.
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
