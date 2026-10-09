import { queryClient } from '@queries/client';
import { databasesKeys, formsKeys } from './keys';

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
