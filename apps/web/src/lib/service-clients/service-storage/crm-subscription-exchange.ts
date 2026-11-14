import { queryAuthorization } from '@app/lib/urql-solid/authorization';
import { fireAndForget } from '@core/util/fireAndForget';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { markSourceAuthority } from '@graphql-cache/source-authority';
import { subscriptionExchange } from '@urql/core';
import { type DocumentNode, print } from 'graphql';
import type { Client as GraphqlWsClient } from 'graphql-ws';
import { crmAccessAuthority } from './crm-access-authority';

/** Capture permission at each underlying subscription, including reconnects. */
export function graphqlSoupSubscriptionExchange(
  websocketClient: Pick<GraphqlWsClient, 'subscribe'>,
  stripClientDirectives: (document: DocumentNode) => DocumentNode
) {
  return subscriptionExchange({
    forwardSubscription(payload, request) {
      const graphqlWsPayload = {
        query: print(stripClientDirectives(request.query)),
        operationName: payload.operationName,
        variables: payload.variables,
        extensions: payload.extensions,
      };
      return {
        subscribe(sink) {
          let disposed = false;
          let stop = () => {};
          let attempt = 0;
          let delivered = Promise.resolve();
          let waitingForProof = false;
          const start = async () => {
            const version = ++attempt;
            stop();
            if (!crmAccessAuthority.account()) return;
            const captured = await crmAccessAuthority
              .refresh()
              .catch((error: unknown) => {
                if (!disposed && version === attempt) waitingForProof = true;
                throw error;
              });
            if (disposed || version !== attempt) return;
            waitingForProof = false;
            const sourceEpoch = queryAuthorization().epoch;
            stop = websocketClient.subscribe(graphqlWsPayload, {
              ...sink,
              next(value) {
                delivered = delivered
                  .catch(() => {})
                  .then(async () => {
                    if (disposed || version !== attempt) return;
                    await crmAccessAuthority.refresh();
                    try {
                      await crmAccessAuthority.assertCurrent(captured);
                    } catch (error) {
                      if (error instanceof StaleCacheAuthorityError) {
                        await start();
                        return;
                      }
                      throw error;
                    }
                    if (disposed || version !== attempt) return;
                    markSourceAuthority(
                      value.data,
                      captured.generation,
                      sourceEpoch
                    );
                    sink.next({
                      ...value,
                      extensions:
                        value.extensions && typeof value.extensions === 'object'
                          ? value.extensions
                          : undefined,
                    });
                  });
                fireAndForget(delivered, 'crm.access.subscription');
              },
            });
          };
          const stopSession = crmAccessAuthority.onSessionChanged(() =>
            fireAndForget(start(), 'crm.access.subscription')
          );
          // A failed initial proof leaves no socket to reconnect. Resume only
          // after another request verifies access, never in a failure loop.
          const stopVerified = crmAccessAuthority.onVerified(() => {
            if (!waitingForProof || disposed) return;
            waitingForProof = false;
            fireAndForget(start(), 'crm.access.subscription');
          });
          fireAndForget(start(), 'crm.access.subscription');
          return {
            unsubscribe() {
              disposed = true;
              attempt += 1;
              stopSession();
              stopVerified();
              stop();
            },
          };
        },
      };
    },
  });
}
