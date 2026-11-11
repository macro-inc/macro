import { useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { getDefaultTimezone } from '@core/util/cron';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import type { IdeasSource } from '../context/ideas-source';
import { type Idea, ideaStatus } from '../core/idea';
import { useIdeasFlag } from '../use-ideas-flag';
import { toIdea, toIdeas } from './decode';
import { ideasKeys } from './keys';

/** How often to read again while a run is under way. */
const RUNNING_POLL_MS = 5_000;

function feedOptions(userId: string, enabled: boolean) {
  return queryOptions({
    ...ideasKeys.feed(userId),
    queryFn: async () =>
      toIdeas(
        await throwOnErr(() =>
          scheduledActionClient.listIdeas({ timezone: getDefaultTimezone() })
        )
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((idea) => ideaStatus(idea) === 'running')
        ? RUNNING_POLL_MS
        : false,
  });
}

/**
 * The person's ideas from the scheduler service. Nothing is read while ideas
 * are off. The feed is read again after each write, since the server decides
 * where an idea goes next, and every few seconds while a run is under way.
 */
export function useIdeasSource(): IdeasSource {
  const enabled = useIdeasFlag();
  const userId = useUserId();
  const feed = useQuery(() =>
    feedOptions(userId() ?? '', enabled() && userId() !== undefined)
  );
  const queryClient = useQueryClient();
  const key = () => feedOptions(userId() ?? '', false).queryKey;
  const refresh = async () => {
    await feed.refetch();
  };

  // FE-49: the feed is read again under open cards; an idea that didn't
  // change keeps its object, so its card isn't rebuilt.
  const ideas = createMemo<Idea[] | undefined>((previous) =>
    feed.data?.map((idea) => {
      const before = previous?.find((other) => other.id === idea.id);
      return before && deepEqual(before, idea) ? before : idea;
    })
  );

  return {
    ideas,
    failed: () => feed.isError && ideas() === undefined,
    retry: () => fireAndForget(refresh(), 'ideas'),
    refresh,
    async accept(idea) {
      const { changed } = await throwOnErr(() =>
        scheduledActionClient.acceptIdea({
          ideaId: idea.id,
          body: { updatedAt: idea.updatedAt },
        })
      );
      // The refusal carries the idea as it is now: show that, without
      // another read.
      const now = changed && toIdea(changed);
      if (!now) {
        await refresh();
        return changed ? 'changed' : 'accepted';
      }

      queryClient.setQueryData(key(), (ideas: Idea[] | undefined) =>
        ideas?.map((other) => (other.id === now.id ? now : other))
      );
      return 'changed';
    },
    async dismiss(id, options) {
      await throwOnErr(() =>
        scheduledActionClient.dismissIdea({
          ideaId: id,
          // Sent as the page goes away, it must outlive it.
          keepalive: options?.leaving,
        })
      );
      await refresh();
    },
  };
}
