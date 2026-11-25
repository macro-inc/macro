// The calendar create harness passes its own client and cache host, so the
// app's Soup client, with its session and flag wiring, is never needed.
export function getGraphqlSoupClient(): never {
  throw new Error('The calendar create harness passes its own client');
}

export function getGraphqlSoupCacheHost(): undefined {
  return undefined;
}
