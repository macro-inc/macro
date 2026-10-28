import {
  AgentSessionMentionsDocument,
  type SoupInput,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

export async function fetchGraphqlAgentSessionMentions(input: SoupInput) {
  const result = await getGraphqlSoupClient()
    .query(
      AgentSessionMentionsDocument,
      { input },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Missing agent session response');
  return result.data.user.soup.items.flatMap((item) =>
    item.__typename === 'GraphqlSoupAgentSession' ? [item] : []
  );
}
