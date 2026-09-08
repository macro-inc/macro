import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import {
  ActivityWorkDetailsDocument,
  type ActivityWorkDetailsQuery,
  type ActivityWorkDetailsQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import {
  EMAIL_HISTORY_LIMIT,
  type EmailContact,
  type EmailThreadSummary,
} from '../core/email-network';
import type { ActivityTopEntity } from '../core/event';
import { buildRelatedActivityInput } from './workspace-activity-query';

export function createWorkDetailsQuery(
  context: Pick<ActivityContext, 'graphql'>,
  entities: Accessor<Pick<ActivityTopEntity, 'entityId' | 'entityType'>[]>
) {
  const input = createMemo(
    () => buildRelatedActivityInput(entities()),
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );
  return createUrqlQuery<
    ActivityWorkDetailsQuery,
    ActivityWorkDetailsQueryVariables,
    EmailThreadSummary[]
  >(() => ({
    query: ActivityWorkDetailsDocument,
    client: context.graphql(),
    variables: { input: input()!, messageLimit: EMAIL_HISTORY_LIMIT },
    enabled: input() !== undefined,
    requestPolicy: 'cache-and-network',
    keepPreviousData: false,
    select: (data) =>
      data.user.soup.items.flatMap((item) => {
        if (item.__typename !== 'GraphqlSoupEmailThread') return [];
        const contact = (person: {
          email: string;
          name?: string | null;
          photoUrl?: string | null;
        }): EmailContact => ({
          email: person.email,
          name: person.name,
          picture: person.photoUrl,
        });
        return [
          {
            id: item.id,
            name: item.displayName,
            ownerId: item.ownerId,
            latestInboundAt: item.latestInboundMessageTs,
            participants: item.participants.flatMap((person) =>
              person.email
                ? [
                    {
                      email: person.email,
                      name: person.name,
                      picture: person.sfsPhotoUrl,
                    },
                  ]
                : []
            ),
            latest: item.latestContentMessage && {
              isSent: item.latestContentMessage.isSent,
              replyingToId: item.latestContentMessage.replyingToId,
              at:
                item.latestContentMessage.internalDateTs ??
                item.latestContentMessage.sentAt,
              from:
                item.latestContentMessage.from &&
                contact(item.latestContentMessage.from),
              to: item.latestContentMessage.to.map(contact),
              cc: item.latestContentMessage.cc.map(contact),
            },
            recentMessages: item.messages?.map((message) => ({
              isSent: message.isSent,
              isDraft: message.isDraft,
              at: message.internalDateTs ?? message.sentAt,
              from: message.from && contact(message.from),
            })),
          },
        ];
      }),
  }));
}
