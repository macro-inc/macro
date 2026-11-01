import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { type Span, Telemetry } from '@macro-inc/observability';
import { MailAccountsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createRequest } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createLiveQuery } from '../../graphql-cache/solid/create-live-query';

/** Reconcile account edits with mounted composers and the durable catalog. */
export function refreshMailAccounts(parentSpan?: Span): Promise<void> {
  const refresh = async (span: Span) => {
    try {
      const client = getGraphqlSoupClient();
      const operation = client.createRequestOperation(
        'query',
        createRequest(MailAccountsDocument, {}),
        { requestPolicy: 'network-only' }
      );
      const fetch = operation.context.fetch;
      // urql schedules the transport later. Re-enter the refresh context at
      // dispatch, retaining the client's configured authentication/cache host.
      const result = await client
        .executeRequestOperation({
          ...operation,
          context: {
            ...operation.context,
            ...(fetch && {
              fetch: (input: RequestInfo | URL, init?: RequestInit) =>
                span.run(() => fetch(input, init)),
            }),
          },
        })
        .toPromise();
      // A nullable sendAs error must not discard healthy inboxes or their aliases.
      if (!result.data)
        throw (
          result.error ?? new Error('Mail accounts refresh returned no data')
        );
      const metadata = normalizedCacheResultMetadata(result);
      if (metadata?.source === 'live-network') await metadata.persistence;
    } catch (error) {
      span.error('Mail account refresh failed');
      throw error;
    }
  };
  return parentSpan
    ? parentSpan.span('email.settings.refresh', refresh)
    : Telemetry.span('email.settings.refresh', refresh);
}

/** One identity-scoped GraphQL catalog for inboxes and their verified senders.
 * Alias failures are per inbox; a partial response still exposes healthy accounts. */
export function useMailAccountsQuery(enabled: Accessor<boolean> = () => true) {
  const query = createLiveQuery(
    MailAccountsDocument,
    () => ({}),
    () => ({
      enabled: enabled(),
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network' as const,
      select: (data) => ({
        links: data.user.emailLinks.map((link) => ({
          id: link.id,
          email_address: link.emailAddress,
          provider: link.provider,
          photo_url: link.photoUrl,
          macro_id: link.macroId,
          is_primary: link.isPrimary,
          needs_reauth: link.needsReauth,
          draft_is_signal: link.draftIsSignal,
          sendAs:
            link.sendAs?.map((sender) => ({
              email_address: sender.emailAddress,
              displayName: sender.displayName ?? undefined,
            })) ?? null,
          settings: {
            signature: link.settings.signature,
            signature_on_replies_forwards:
              link.settings.signatureOnRepliesForwards,
          },
        })),
      }),
    })
  );
  return {
    get isPending() {
      return !query.data && query.isLoading;
    },
    get isError() {
      return !query.data && !!query.error;
    },
    get isSuccess() {
      return !!query.data;
    },
    get data() {
      return query.data;
    },
  };
}
