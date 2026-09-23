/** Email queries adapted to the entity data model. */
import type { SafeFetchInit } from '@core/util/safeFetch';
import { emailClient } from '@service-email/client';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import type { PreviewsInboxCursorParams } from '@service-email/generated/schemas/previewsInboxCursorParams';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/solid-query';

import { type Accessor, createMemo } from 'solid-js';
import type { EmailEntity } from '../types/entity';
import { createApiTokenQuery, withCachedApiTokenRetry } from './auth';
import { queryKeys } from './key';

type FetchPaginatedEmailsParams = PreviewsInboxCursorParams & {
  // path parameter
  view: PreviewViewStandardLabel;
};

const fetchPaginatedEmails = async ({
  apiToken,
  view,
  ...params
}: FetchPaginatedEmailsParams & { apiToken: string }) => {
  const Authorization = `Bearer ${apiToken}`;
  const init: SafeFetchInit = {
    headers: { Authorization },
  };

  const result = await emailClient.getPreviews(
    {
      view,
      limit: params.limit,
      sort_method: params.sort_method,
      cursor: params.cursor,
    },
    init
  );

  if (result.isErr()) {
    throw new Error('Failed to fetch email');
  }

  return result.value;
};

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
    queryFn: ({ pageParam }) =>
      withCachedApiTokenRetry((apiToken) =>
        fetchPaginatedEmails({ apiToken, ...pageParam })
      ),
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

  const authQuery = createApiTokenQuery();
  const enabled = createMemo(
    () => authQuery.isSuccess && !options?.disabled?.()
  );
  return useInfiniteQuery(() =>
    emailsInfiniteQueryOptions(
      params(),
      enabled(),
      options?.refetchInterval?.()
    )
  );
}
