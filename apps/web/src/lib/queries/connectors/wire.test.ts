// The web's connector types are generated from the server's OpenAPI document,
// which utoipa derives from the Rust types; serde decides what the server
// actually sends. These tests pin the two together: the JSON below is what
// `crates/connectors/src/inbound/dto/test.rs` asserts the Rust types
// serialize to. Each literal must satisfy the generated type (checked by the
// type checker), and each schema in openapi.json must name exactly its keys.
import type {
  CatalogPage,
  Connector,
  ConnectStep,
} from '@service-cognition/generated/schemas';
import openapi from '@service-cognition/openapi.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

const APP_CONNECTOR = {
  key: 'app/linear',
  target: { type: 'app', slug: 'linear' },
  name: 'Linear',
  status: 'needsReauth',
  connectable: true,
  mcp: true,
  api: true,
  importAvailable: true,
} as const satisfies Connector;

const SERVER_TARGET = {
  type: 'server',
  url: 'https://mcp.example.com/mcp',
} as const satisfies Connector['target'];

const OPEN_URL = {
  type: 'openUrl',
  url: 'https://connect.example.com/start?x=1',
} as const satisfies ConnectStep;

const EMBEDDED_DIALOG = {
  type: 'embeddedDialog',
  token: 'ctok_1',
  expiresAt: '2026-11-22T00:00:00Z',
  link: 'https://connect.example.com/link',
} as const satisfies ConnectStep;

const CATALOG_PAGE = {
  apps: [
    {
      key: 'app/linear',
      slug: 'linear',
      name: 'Linear',
      description: null,
      iconUrl: null,
      categories: [],
      orgSetup: null,
    },
  ],
  nextCursor: null,
} as const satisfies CatalogPage;

type Schema = {
  properties?: Record<string, unknown>;
  oneOf?: Schema[];
};

function schema(name: string): Schema {
  const schemas = openapi.components.schemas as unknown as Record<
    string,
    Schema | undefined
  >;
  const found = schemas[name];
  if (!found) throw new Error(`openapi.json has no ${name} schema`);
  return found;
}

const keys = (value: object) => Object.keys(value).sort();
const propertyKeys = (value: Schema) =>
  Object.keys(value.properties ?? {}).sort();

describe('the generated connector types match what the server sends', () => {
  it('Connector', () => {
    expect(propertyKeys(schema('Connector'))).toEqual(keys(APP_CONNECTOR));
  });

  it('Connector target, for an app and for a server', () => {
    const variants = (schema('Connector').properties?.target ?? {}) as Schema;
    const targets = (
      variants.oneOf ??
      schema('ConnectorTarget').oneOf ??
      []
    ).map(propertyKeys);
    expect(targets).toEqual(
      expect.arrayContaining([keys(APP_CONNECTOR.target), keys(SERVER_TARGET)])
    );
  });

  it('ConnectStep, both steps', () => {
    expect(schema('ConnectStep').oneOf?.map(propertyKeys)).toEqual(
      expect.arrayContaining([keys(OPEN_URL), keys(EMBEDDED_DIALOG)])
    );
  });

  it('CatalogPage and CatalogApp', () => {
    expect(propertyKeys(schema('CatalogPage'))).toEqual(keys(CATALOG_PAGE));
    expect(propertyKeys(schema('CatalogApp'))).toEqual(
      keys(CATALOG_PAGE.apps[0])
    );
  });
});
