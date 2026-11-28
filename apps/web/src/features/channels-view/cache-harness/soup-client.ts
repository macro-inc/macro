/**
 * The cached Soup client `getGraphqlSoupClient` builds in the browser, over a
 * harness host and the fixture network instead of the page's host, `fetch`
 * and websocket. The exchanges and their options are production's
 * (`graphql-soup.ts`), less the mutation queue's telemetry, email draft
 * lifecycle and CRM scoping, which the Chat sidebar's reads never reach.
 */
import {
  captureTraceParentExchange,
  traceParentExchange,
} from '@app/lib/urql-solid/trace-parent-exchange';
import { entityFromArgument } from '@graphql-cache/exchange/entity-resolvers';
import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { optimisticResolversExchange } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  createCacheSessionExchange,
  sessionSubscriptionExchange,
} from '@graphql-cache/exchange/session-exchange';
import type { FixtureNetwork } from '@graphql-cache/headless/fixture-network';
import type { CacheHost } from '@graphql-cache/host/types';
import { delegateChannelNotificationRefresh } from '@queries/channel/notification-refresh';
import { soupOptimisticResolvers } from '@queries/optimistic-resolvers';
import { channelMembershipReceiptExchange } from '@service-storage/channel-membership';
import type { SoupQuery } from '@service-storage/graphql/generated/graphql';
import { isActivityUpdatesSubscription } from '@service-storage/graphql-activity-updates';
import { notificationReceiptExchange } from '@service-storage/graphql-notification-receipt';
import { publishNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { type Client, createClient } from '@urql/core';
import { type DocumentNode, visit } from 'graphql';

/** `graphql-soup.ts`'s private `stripGraphqlSoupClientDirectives`. */
function stripClientDirectives(document: DocumentNode): DocumentNode {
  return visit(document, {
    Directive(node) {
      return node.name.value === 'cacheOnly' ? null : undefined;
    },
  });
}

export type HarnessClients = {
  client: Client;
  networkClient: Client;
  dispose(): void;
};

export function createHarnessClients(
  host: CacheHost,
  network: FixtureNetwork
): HarnessClients {
  const lifetime = new AbortController();
  const client = createClient({
    url: 'https://cache-harness.invalid/items/soup/graphql',
    preferGetMethod: false,
    exchanges: [
      createCacheSessionExchange(lifetime.signal),
      captureTraceParentExchange,
      optimisticResolversExchange(soupOptimisticResolvers),
      networkRevalidationExchange(() => host.disabled === true),
      normalizedCacheExchange(host, {
        signal: lifetime.signal,
        entityResolvers: {
          GraphqlUser: {
            emailThread: entityFromArgument('GraphqlSoupEmailThread', [
              'input',
              'threadId',
            ]),
            visibleInitiative: entityFromArgument('GraphqlSoupInitiative', [
              'initiativeId',
            ]),
          },
        },
        extractIdentity: (data) =>
          (data as Partial<SoupQuery> | undefined)?.user?.id,
        delegateRevalidation: delegateChannelNotificationRefresh,
        isUncachedSubscription: isActivityUpdatesSubscription,
      }),
      notificationReceiptExchange(publishNotificationPatch),
      channelMembershipReceiptExchange(),
      sessionSubscriptionExchange(network.socket, stripClientDirectives),
      traceParentExchange,
      network.exchange,
    ],
  });
  const networkClient = createClient({
    url: 'https://cache-harness.invalid/items/soup/graphql',
    preferGetMethod: false,
    exchanges: [network.exchange],
  });
  return {
    client,
    networkClient,
    dispose: () => lifetime.abort(),
  };
}
