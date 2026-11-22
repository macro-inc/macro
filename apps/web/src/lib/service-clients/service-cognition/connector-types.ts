// Hand-written mirrors of the `/connectors` API types, until the cognition
// client is regenerated from the server's OpenAPI document.

/** Where a user stands with an app or server. */
export type ConnectorStatus =
  | 'connected'
  | 'disabled'
  | 'needsReauth'
  | 'notConnected';

/** What a connector key names. */
export type ConnectorTarget =
  | { type: 'app'; slug: string }
  | { type: 'server'; url: string };

/** One app or server and where the user stands with it. */
export interface Connector {
  key: string;
  target: ConnectorTarget;
  name: string;
  status: ConnectorStatus;
  connectable: boolean;
  mcp: boolean;
  api: boolean;
  importAvailable: boolean;
}

/** What the user must do next to connect. */
export type ConnectStep =
  | { type: 'openUrl'; url: string }
  | { type: 'embeddedDialog'; token: string; expiresAt: string; link: string };

export interface AddServerRequest {
  url: string;
  name: string;
}

export interface UpdateConnectorRequest {
  enabled?: boolean;
  name?: string;
}

export interface CatalogApp {
  key: string;
  slug: string;
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  categories: string[];
}

export interface CatalogPage {
  apps: CatalogApp[];
  nextCursor?: string | null;
}
