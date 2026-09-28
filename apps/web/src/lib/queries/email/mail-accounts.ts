import { createUrqlQuery } from '@app/lib/urql-solid';
import { MailAccountsDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { useEmailLinksQuery } from './link';

/** Mail's account choices can be read from the identity-scoped normalized catalog
 * after a reload offline. REST remains the fallback for non-cache transports. */
export function useMailAccountsQuery() {
  const rest = useEmailLinksQuery();
  const cached = createUrqlQuery(() => ({
    query: MailAccountsDocument,
    client: getGraphqlSoupClient(),
    enabled: graphqlCacheEnabled(),
    requestPolicy: 'cache-and-network' as const,
    select: (data) => ({
      links: data.user.emailLinks.map((link) => ({
        id: link.id,
        email_address: link.emailAddress,
        photo_url: link.photoUrl,
        macro_id: link.macroId,
        is_primary: link.isPrimary,
        needs_reauth: link.needsReauth,
        draft_is_signal: link.draftIsSignal,
        settings: {
          signature: link.settings.signature,
          signature_on_replies_forwards:
            link.settings.signatureOnRepliesForwards,
        },
      })),
    }),
  }));
  return {
    get isPending() {
      return graphqlCacheEnabled()
        ? cached.isLoading && !rest.isSuccess
        : rest.isPending;
    },
    get isError() {
      return !cached.isLoading && !cached.data && rest.isError;
    },
    get isSuccess() {
      return (!cached.isLoading && !!cached.data) || rest.isSuccess;
    },
    get data() {
      return (
        (!cached.isLoading ? cached.data : undefined) ??
        (rest.isSuccess ? rest.data : undefined)
      );
    },
  };
}
