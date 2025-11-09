import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { SERVER_HOSTS } from 'core/constant/servers';
import { platformFetch } from 'core/util/platformFetch';
import type { GetPreviewsCursorResponse } from 'service-email/generated/schemas/getPreviewsCursorResponse';
import type { PreviewsInboxCursorParams } from 'service-email/generated/schemas/previewsInboxCursorParams';
import { type Accessor, createMemo } from 'solid-js';
import type { EmailEntity } from '../types/entity';
import { createApiTokenQuery } from './auth';
import { queryKeys } from './key';

export type FetchPaginatedEmailsParams = PreviewsInboxCursorParams & {
  // path parameter
  view: PreviewViewStandardLabel;
};

const fetchPaginatedEmails = async ({
  apiToken,
  view,
  ...params
}: FetchPaginatedEmailsParams & {
  apiToken?: string;
}) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const url = new URL(
    `${SERVER_HOSTS['email-service']}/email/threads/previews/cursor/${view}`
  );
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value.toString());
  });

  const response = await platformFetch(url.toString(), {
    headers: { Authorization },
  });
  if (!response.ok)
    throw new Error('Failed to fetch email', { cause: response });

  const { previews }: GetPreviewsCursorResponse = await response.json();
  return previews;
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
        fetchPaginatedEmails({ apiToken: authQuery.data, ...pageParam }),
      initialPageParam: params(),
      getNextPageParam: ({ next_cursor: cursor }) =>
        cursor ? { ...params(), cursor } : undefined,
      select: (data) =>
        data.pages.flatMap(({ items }) =>
          items.map(
            (email): EmailEntity => ({
              ...email,
              type: 'email',
              name: email.name || 'No Subject',
              // @ts-expect-error - frecency_score is not typed in the response
              frecencyScore: email.frecency_score,
              viewedAt: email.viewedAt ?? undefined,
              snippet: email.snippet ?? undefined,
              isImportant: email.isImportant ?? false,
              done: !email.inboxVisible,
              senderEmail: email.senderEmail ?? undefined,
              senderName: email.senderName ?? email.senderEmail ?? undefined,
            })
          )
        ),
      enabled: enabled(),
      refetchInterval: options?.refetchInterval?.(),
    };
  });
}
