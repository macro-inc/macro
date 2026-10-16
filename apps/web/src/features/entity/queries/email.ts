/** Email queries adapted to the entity data model. */
import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import type { PreviewsInboxCursorParams } from '@service-email/generated/schemas/previewsInboxCursorParams';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/solid-query';

import type { Accessor } from 'solid-js';
import type { EmailEntity } from '../types/entity';
import { queryKeys } from './key';

type FetchPaginatedEmailsParams = PreviewsInboxCursorParams & {
  // path parameter
  view: PreviewViewStandardLabel;
};

const fetchPaginatedEmails = async ({
  view,
  ...params
}: FetchPaginatedEmailsParams) =>
  // The email client already authenticates with the current session.
  throwOnErr(() =>
    emailClient.getPreviews({
      view,
      limit: params.limit,
      sort_method: params.sort_method,
      cursor: params.cursor,
    })
  );

type EmailPreviewPage = Awaited<ReturnType<typeof fetchPaginatedEmails>>;

function selectEmailEntities(data: {
  pages: EmailPreviewPage[];
}): EmailEntity[] {
  return data.pages.flatMap(({ items }) =>
    items.map((email): EmailEntity => {
      const participants = email.contacts.map((p) => ({
        email: p.emailAddress ?? '',
        name: p.name ?? '',
      }));

      return {
        ...email,
        type: 'email',
        name: email.name || 'No Subject',
        createdAt: email.createdAt,
        updatedAt: email.updatedAt,
        frecencyScore: email.frecencyScore ?? undefined,
        viewedAt: email.viewedAt,
        snippet: email.snippet ?? undefined,
        isImportant: email.isImportant ?? false,
        done: !email.inboxVisible,
        participants,
        senderEmail: email.senderEmail ?? undefined,
        senderName: email.senderName ?? email.senderEmail ?? undefined,
      };
    })
  );
}

// Cached callbacks only close over the resolved request params.
function emailsInfiniteQueryOptions(
  params: FetchPaginatedEmailsParams,
  enabled: boolean,
  refetchInterval: number | undefined
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.email({ infinite: true, ...params }),
    queryFn: ({ pageParam }) => fetchPaginatedEmails(pageParam),
    initialPageParam: params,
    getNextPageParam: ({ next_cursor: cursor }) =>
      cursor ? { ...params, cursor } : undefined,
    select: selectEmailEntities,
    enabled,
    refetchInterval,
  });
}

export function createEmailsInfiniteQuery(
  args?: Accessor<FetchPaginatedEmailsParams>,
  options?: {
    refetchInterval?: Accessor<number | undefined>;
    disabled?: Accessor<boolean>;
  }
) {
  const params = () => {
    const argParams = args?.();
    const limit =
      argParams?.limit && argParams.limit > 0 && argParams.limit <= 500
        ? argParams.limit
        : 500;
    const view = argParams?.view ?? 'all';
    return {
      ...argParams,
      limit,
      view,
    };
  };

  return useInfiniteQuery(() =>
    emailsInfiniteQueryOptions(
      params(),
      !options?.disabled?.(),
      options?.refetchInterval?.()
    )
  );
}
