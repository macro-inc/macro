import { AsyncBatcher } from '@tanstack/pacer';
import type { AgentSessionMentionPreview } from './mention-types';

/** Query-owned batching; TanStack Query owns caching and observer lifetimes. */
export function createAgentSessionMentionBatcher(
  fetch: (ids: string[]) => Promise<Map<string, AgentSessionMentionPreview>>
) {
  type Request = {
    id: string;
    resolve: (value: AgentSessionMentionPreview) => void;
    reject: (error: unknown) => void;
  };
  const batcher = new AsyncBatcher<Request>(
    (requests) => fetch([...new Set(requests.map((request) => request.id))]),
    {
      wait: 30,
      maxSize: 50,
      onSuccess: (results, requests) => {
        for (const request of requests) {
          const result = results.get(request.id);
          if (result) request.resolve(result);
          else request.reject(new Error('Missing agent session preview'));
        }
      },
      onError: (error, requests) => {
        for (const request of requests) request.reject(error);
      },
      throwOnError: false,
    }
  );
  return (id: string) =>
    new Promise<AgentSessionMentionPreview>((resolve, reject) => {
      batcher.addItem({ id, resolve, reject });
    });
}
