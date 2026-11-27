// The document check's default host and server reader load the app's GraphQL
// client; the deleted document harness passes its own.
export function getGraphqlSoupCacheHost(): undefined {
  return undefined;
}

export function getGraphqlSoupClient(): never {
  throw new Error('the deleted document harness reads no server');
}
