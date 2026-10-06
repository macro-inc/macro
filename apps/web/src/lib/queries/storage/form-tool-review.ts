import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { formDetailQueryOptions } from './forms';
import { databasesKeys, formsKeys } from './keys';

type Args = NamedTool<'SetFormAccess', 'call'>['data'];
/** Every review fetches current detail before enabling a decision, even with a warm builder cache. */
export function useFormAccessReviewQuery(args: Accessor<Args | undefined>) {
  return useQuery(() => {
    const current = args();
    const detail = formDetailQueryOptions(current?.formId ?? '');
    return {
      ...detail,
      queryKey: [
        ...detail.queryKey,
        'access-review',
        current?.requestId,
        current?.baseRevision,
      ],
      enabled: !!current,
      staleTime: 0,
      refetchOnMount: 'always' as const,
      retry: false,
    };
  });
}
export type FormReviewIdentity = {
  chat_id: string;
  messageId: string;
  toolCallId: string;
};
export const executeFormReview = (identity: FormReviewIdentity, args: Args) =>
  cognitionApiServiceClient.callTool<'SetFormAccess'>({ ...identity, args });
export const persistFormReview = (identity: FormReviewIdentity, args: Args) =>
  cognitionApiServiceClient.updateToolCall<'SetFormAccess'>({
    ...identity,
    args,
  });
export const rejectFormReview = (identity: FormReviewIdentity) =>
  cognitionApiServiceClient.rejectToolCall(identity);
export async function invalidateAuthoredForm(
  formId: string,
  databaseId?: string
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey }),
    queryClient.invalidateQueries({
      queryKey: formsKeys.detail(formId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: formsKeys.permissions(formId).queryKey,
    }),
    ...(databaseId
      ? [
          queryClient.invalidateQueries({
            queryKey: formsKeys.forDatabase(databaseId).queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: databasesKeys.detail(databaseId).queryKey,
          }),
        ]
      : []),
  ]);
}
