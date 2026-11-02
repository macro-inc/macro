import type { Client } from '@urql/core';
import type { channelPage } from '../tests/detail-cache-fixture';

let client: Client;
export function setClient(value: Client) {
  client = value;
}
export function getGraphqlSoupClient() {
  return client;
}
export function mapGraphqlSoupPage(data: ReturnType<typeof channelPage>) {
  return { items: data.user.soup.items };
}
export function mapApiSoupItemToEntity(item: { id: string; name: string }) {
  return {
    ...item,
    type: 'channel',
    ownerId: 'viewer',
    channelType: 'private',
  };
}
