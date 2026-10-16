import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { MailAccountsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createLiveQuery } from '../../graphql-cache/solid/create-live-query';

/** Reconcile account edits with mounted composers and the durable catalog. */
export async function refreshMailAccounts(): Promise<void> {
  const result = await getGraphqlSoupClient()
    .query(MailAccountsDocument, {}, { requestPolicy: 'network-only' })
    .toPromise();
  // A nullable sendAs error must not discard healthy inboxes or their aliases.
  if (!result.data)
    throw result.error ?? new Error('Mail accounts refresh returned no data');
  const metadata = normalizedCacheResultMetadata(result);
  if (metadata?.source === 'live-network') await metadata.persistence;
}

/** One identity-scoped GraphQL catalog for inboxes and their verified senders.
 * Alias failures are per inbox; a partial response still exposes healthy accounts. */
export function useMailAccountsQuery() {
  const query = createLiveQuery(
    MailAccountsDocument,
    () => ({}),
    () => ({
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
