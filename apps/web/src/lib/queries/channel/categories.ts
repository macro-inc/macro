import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import {
  type ChannelCategoryLayout,
  storageServiceClient,
} from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { createEffect, on } from 'solid-js';

import { queryClient } from '../client';
import {
  type ChannelCategoryIntent,
  ChannelCategoryMutationQueue,
  StaleCategorySessionError,
} from './category-layout';
import { channelKeys } from './keys';

export function useChannelCategoryLayoutQuery() {
  const userId = useUserId();
  const initialUserId = userId();
  if (initialUserId) categorySessions.activate(initialUserId);
  createEffect(
    on(userId, (id) => {
      if (id) categorySessions.activate(id);
      else categorySessions.clear();
    })
  );
  return useQuery(() => {
    const id = userId() ?? '';
    if (id) categorySessions.activate(id);
    return {
      queryKey: channelKeys.categoryLayout(id).queryKey,
      queryFn: async () => {
        const session = categorySessions.require(id);
        session.assertActive();
        const layout = await throwOnErr(() =>
          storageServiceClient.getChannelCategoryLayout()
        );
        session.assertActive();
        return layout;
      },
      staleTime: 60_000,
      enabled: Boolean(id),
    };
  });
}

/** Keep category state aligned with the application's reactive auth boundary. */
export function useChannelCategoryAuthentication() {
  const userId = useUserId();
  createEffect(on(userId, transitionChannelCategoryAuthentication));
}

/** Dispose category state from the prior immutable authentication generation. */
export function transitionChannelCategoryAuthentication(
  userId: string | undefined
) {
  if (userId) categorySessions.activate(userId);
  else categorySessions.clear();
}

type CategorySession = {
  readonly userId: string;
  readonly generation: number;
  queue?: ChannelCategoryMutationQueue;
  assertActive: () => void;
};

let generation = 0;
let activeSession: CategorySession | undefined;

const categorySessions = {
  activate(userId: string): CategorySession {
    if (activeSession?.userId === userId) return activeSession;
    const priorSession = activeSession;
    priorSession?.queue?.dispose();
    if (priorSession) {
      queryClient.removeQueries({
        queryKey: channelKeys.categoryLayout(priorSession.userId).queryKey,
        exact: true,
      });
    }
    const sessionGeneration = ++generation;
    const session: CategorySession = {
      userId,
      generation: sessionGeneration,
      assertActive: () => {
        if (activeSession !== session || generation !== sessionGeneration) {
          throw new StaleCategorySessionError();
        }
      },
    };
    activeSession = session;
    return session;
  },
  clear() {
    const priorSession = activeSession;
    priorSession?.queue?.dispose();
    if (priorSession) {
      queryClient.removeQueries({
        queryKey: channelKeys.categoryLayout(priorSession.userId).queryKey,
        exact: true,
      });
    }
    activeSession = undefined;
    generation += 1;
  },
  require(userId: string) {
    if (!activeSession || activeSession.userId !== userId) {
      throw new StaleCategorySessionError();
    }
    activeSession.assertActive();
    return activeSession;
  },
  current(userId: string) {
    return activeSession?.userId === userId ? activeSession : undefined;
  },
};

export function useReplaceChannelCategoryLayoutMutation() {
  const userId = useUserId();
  const query = useChannelCategoryLayoutQuery();
  createEffect(() => {
    const id = userId();
    const layout = query.data;
    if (!id) {
      categorySessions.clear();
      return;
    }
    const session = categorySessions.current(id);
    if (!session) return;
    if (layout) session.queue?.absorbConfirmed(layout);
  });
  return useMutation(() => ({
    mutationFn: async (intent: ChannelCategoryIntent) => {
      const id = userId();
      if (!id) throw new Error('Channel category user is not authenticated');
      const session = categorySessions.require(id);
      session.assertActive();
      const queryKey = channelKeys.categoryLayout(id).queryKey;
      await queryClient.cancelQueries({
        queryKey,
      });
      const initial = queryClient.getQueryData<ChannelCategoryLayout>(queryKey);
      session.assertActive();
      let queue = session.queue;
      if (!queue) {
        if (!initial) throw new Error('Channel category layout is not loaded');
        queue = new ChannelCategoryMutationQueue(
          initial,
          async (layout) => {
            session.assertActive();
            const confirmed = await throwOnErr(() =>
              storageServiceClient.replaceChannelCategoryLayout(layout)
            );
            session.assertActive();
            return confirmed;
          },
          async () => {
            session.assertActive();
            const confirmed = await throwOnErr(() =>
              storageServiceClient.getChannelCategoryLayout()
            );
            session.assertActive();
            return confirmed;
          },
          (layout) => {
            session.assertActive();
            queryClient.setQueryData(queryKey, layout);
          },
          () => activeSession === session
        );
        session.queue = queue;
      } else if (initial) {
        queue.absorbConfirmed(initial);
      }
      return queue.enqueue(intent);
    },
    onError: (error) => {
      if (error instanceof StaleCategorySessionError) return;
      toast.failure('Could not save channel categories');
    },
  }));
}
