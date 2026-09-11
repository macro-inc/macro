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
      })),
    }),
  }));
  return {
    get data() {
      return (
        (!cached.isLoading ? cached.data : undefined) ??
        (rest.isSuccess ? rest.data : undefined)
      );
    },
  };
}
