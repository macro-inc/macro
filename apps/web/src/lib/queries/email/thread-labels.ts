import { EmailThreadLabelsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import { createLiveQuery } from '../../graphql-cache/solid/create-live-query';
import { isShownLabel, shownLabelsOf, useEmailLabelNames } from './label-names';

/**
 * One thread's labels as its reader may see them: the server leaves out labels
 * made in inboxes the reader doesn't own or manage. Only read from the cached
 * thread, which its list row or the open thread's own page writes, so opening
 * a thread never asks the server for it twice. Never suspends.
 */
function useEmailThreadLabelsQuery(threadId: Accessor<string>) {
  const query = createLiveQuery(
    EmailThreadLabelsDocument,
    () => ({ threadId: threadId() }),
    () => ({
      enabled: threadId().length > 0,
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-only' as const,
      select: (data) => data.user.emailThread?.labels ?? [],
    })
  );
  return {
    get data() {
      return query.data;
    },
  };
}

/**
 * The labels an open thread shows, named as in its inbox: the ones people
 * made that Gmail doesn't hide from the message list.
 */
export function useShownThreadLabels(threadId: Accessor<string>) {
  const labels = useEmailThreadLabelsQuery(threadId);
  const names = useEmailLabelNames(() =>
    (labels.data ?? []).some(isShownLabel)
  );
  return createMemo(() => shownLabelsOf(labels.data ?? [], names()));
}
