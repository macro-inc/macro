import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { refreshEmailThreadCache } from '@queries/email/cache-cleanup';
import { emailKeys } from '@queries/email/keys';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import type { MessageOperationSourceFactory } from '../context/message-operation-source';

export const createMessageOperationSource: MessageOperationSourceFactory = (
  messageId,
  threadId
) => {
  const [needsReload, setNeedsReload] = createSignal(false);
  let refreshedRemote = false;
  const query = useQuery(() => ({
    queryKey: emailKeys.messageOperation(messageId() ?? '').queryKey,
    enabled: !!messageId(),
    queryFn: async () => {
      const result = await throwOnErr(() =>
        emailClient.messageOperation(messageId()!)
      );
      const thread = threadId?.();
      if (
        needsReload() &&
        !refreshedRemote &&
        result.operation?.state === 'SYNCHRONIZED' &&
        thread
      ) {
        await refreshEmailThreadCache(thread);
        await queryClient.invalidateQueries({
          queryKey: emailKeys.thread(thread).queryKey,
        });
        refreshedRemote = true;
      }
      return result;
    },
    retry: false,
    refetchInterval: (query) => {
      const operation = query.state.data?.operation;
      return operation &&
        !['SENT', 'DELETED', 'CANCELLED'].includes(operation.state)
        ? 5000
        : false;
    },
  }));
  return {
    needsReload,
    operation: () => {
      if (!query.isSuccess) return undefined;
      const value = query.data.operation;
      return value
        ? {
            state: value.state,
            revision: value.revision,
            remoteVersion: value.remote_version,
            issue: value.issue,
          }
        : null;
    },
    async resolve(operation, action, acceptDuplicateRisk) {
      const id = messageId();
      if (!id || !operation)
        throw new Error('Refresh this draft and try again.');
      await throwOnErr(() =>
        emailClient.resolveMessageOperation(id, {
          action,
          revision: operation.revision,
          remote_version: operation.remoteVersion,
          accept_duplicate_risk: acceptDuplicateRisk,
        })
      );
      if (action === 'use_provider') setNeedsReload(true);
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: emailKeys._def });
      const thread = threadId?.();
      if (thread) await refreshEmailThreadCache(thread);
    },
  };
};
