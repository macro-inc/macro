import type { SafeFetchInit } from '@core/util/safeFetch';
import type { EmailEntity } from '@entity';
import { emailClient } from '@service-email/client';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import type { PreviewsInboxCursorParams } from '@service-email/generated/schemas/previewsInboxCursorParams';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { isErr } from 'core/util/maybeResult';
import { type Accessor, createMemo } from 'solid-js';
import { createApiTokenQuery, withApiTokenRetry } from './auth';
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

  if (isErr(result)) {
    throw new Error('Failed to fetch email');
  }

  return result[1];
};

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
  return useInfiniteQuery(() => {
    return {
      queryKey: queryKeys.email({ infinite: true, ...params() }),
      queryFn: ({ pageParam }) =>
        withApiTokenRetry(authQuery, (apiToken) =>
          fetchPaginatedEmails({ apiToken, ...pageParam })
        ),
      initialPageParam: params(),
      getNextPageParam: ({ next_cursor: cursor }) =>
        cursor ? { ...params(), cursor } : undefined,
      select: (data) =>
        data.pages.flatMap(({ items }) =>
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
        ),
      enabled: enabled(),
      refetchInterval: options?.refetchInterval?.(),
    };
  });
}
