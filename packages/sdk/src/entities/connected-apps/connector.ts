import type { DiscoverConnectorsResponse } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { CodeExecution } from '../agent-sessions/code-execution';

/** One action a connectable app advertises; not callable until connected. */
export type ConnectorAction = {
  /** The upstream tool name. */
  name: string;
  /** What the action supports. */
  description: string;
};

/** A connector's verified capabilities and the account's connection status. */
export type ConnectorInspection = {
  /** Whether the execution's account has the app connected and enabled. */
  connected: boolean;
  /** The actions the app advertises. */
  actions: ConnectorAction[];
  /** True when some advertised actions were left out. */
  actionsTruncated: boolean;
  /**
   * Markup that gives the user a button to connect the app, present only for
   * an unconnected app with advertised actions. Put it in your reply
   * verbatim, and only when one of `actions` supports the user's task.
   */
  connectMarkup: string | undefined;
};

/**
 * An app the user could connect, found in the connector catalog. Its
 * description is the catalog's; inspect it to see what it can actually do.
 */
export class Connector {
  private constructor(
    private readonly client: MacroClient,
    /** The running execution the catalog is read through. */
    readonly execution: CodeExecution,
    /** The app's catalog slug, e.g. `linear`. */
    readonly slug: string,
    /** Display name, e.g. `Linear`. */
    readonly name: string,
    /** The catalog's description. */
    readonly description: string | undefined,
  ) {}

  /** Search the connector catalog by app name. */
  static async search(
    client: MacroClient,
    execution: CodeExecution,
    appName: string,
  ): Promise<{ connectors: Connector[]; moreResults: boolean }> {
    const response = await discover(client, execution, {
      operation: 'search',
      query: appName,
    });
    if (response.result.operation !== 'search') {
      throw new Error('connector search answered with an inspection');
    }
    return {
      connectors: response.result.apps.map(
        (app) =>
          new Connector(
            client,
            execution,
            app.app_slug,
            app.name,
            app.description ?? undefined,
          ),
      ),
      moreResults: response.result.more_results,
    };
  }

  /**
   * Read the actions this app advertises and whether the execution's account
   * has it connected. Inspection never calls the app or changes a connection.
   *
   * @readonly
   * @mcp-exclude Needs the CodeExecution of a running program.
   */
  async inspect(): Promise<ConnectorInspection> {
    const response = await discover(this.client, this.execution, {
      operation: 'inspect',
      app_slug: this.slug,
    });
    if (response.result.operation !== 'inspect') {
      throw new Error('connector inspection answered with a search');
    }
    return {
      connected: response.result.connected,
      actions: response.result.tools,
      actionsTruncated: response.result.tools_truncated,
      connectMarkup: response.connect_markup ?? undefined,
    };
  }

  /** Serialize the catalog entry, not its client. */
  toJSON() {
    return {
      slug: this.slug,
      name: this.name,
      description: this.description,
    };
  }
}

async function discover(
  client: MacroClient,
  execution: CodeExecution,
  request:
    | { operation: 'search'; query: string }
    | { operation: 'inspect'; app_slug: string },
): Promise<DiscoverConnectorsResponse> {
  return unwrap(
    await client.agentHarness.discoverConnectedApps({
      path: {
        session_id: execution.session().id,
        execution_id: execution.id,
      },
      body: request,
    }),
  );
}
