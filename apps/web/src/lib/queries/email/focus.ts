import { type EmailEntity, isEmailEntity } from '@entity';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  EmailFocusDocument,
  type EmailFocusQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlSoupItem,
} from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '../soup/transform-utils';

/** Days of mail the Focus list covers. */
export const FOCUS_WINDOW_DAYS = 30;

/**
 * The viewer's Focus threads as email rows, most important first, each
 * carrying its classification in `focus`.
 */
export function mapEmailFocus(data: EmailFocusQuery): EmailEntity[] {
  const threads: EmailEntity[] = [];
  for (const thread of data.user.emailFocus) {
    const item = mapGraphqlSoupItem(thread);
    if (!item || !isDisplayableSoupItem(item)) continue;
    const entity = mapApiSoupItemToEntity(item);
    if (!isEmailEntity(entity) || !thread.focus) continue;
    threads.push({
      ...entity,
      focus: {
        category: thread.focus.category,
        importance: thread.focus.importance,
        needsReply: thread.focus.needsReply,
        needsFollowUp: thread.focus.needsFollowUp,
      },
    });
  }
  return threads;
}

/** The viewer's Focus list, read through the shared GraphQL client. */
export function useEmailFocusQuery(enabled: Accessor<boolean>) {
  return createLiveQuery(
    EmailFocusDocument,
    () => (enabled() ? { days: FOCUS_WINDOW_DAYS } : undefined),
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network' as const,
      select: mapEmailFocus,
    })
  );
}
