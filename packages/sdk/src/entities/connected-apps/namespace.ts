import type { MacroClient } from '../../utils/client';
import type { CodeExecution } from '../agent-sessions/code-execution';
import { ConnectedApp } from './connected-app';

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
 * Connected apps are reached only from an agent session's ExecuteCode program: pass the `execution` that `main` receives. `macro.connectedApps.list(execution)` returns the apps this agent was given (every app the user connected, or the agent's own selection); an app missing from it is not available, so tell the user rather than guessing. Read an app's tools with `app.tools()`, pick one by name and description, read its `inputSchema`, then `tool.call(args)`.
 *
 * Calls run in the user's real account through Macro's server, as the account this execution acts as, and take effect at once; the program never sees a credential. Read before writing, and never repeat a write whose outcome is unknown: check the app's state first. A result with `isError` explains itself: when it says an app is not connected, tell the user and include the connect markup it gives you in your reply verbatim, then stop.
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
   */
  list(execution: CodeExecution): Promise<ConnectedApp[]> {
    return ConnectedApp.list(this.client, execution);
  }
}
