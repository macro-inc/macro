import { revalidateActivityQueries } from '@queries/activity/push-registry';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createMockGraphql } from '../../activity/tests/mock-graphql';
import { observeProjectTaskChanges } from './project-task-revalidation';

describe('project task hydration freshness', () => {
  it('refreshes relevant events and reconnects, follows membership, and stops on disposal', async () => {
    const graphql = createMockGraphql();
    const refresh = vi.fn(async () => {});
    const [taskIds, setTaskIds] = createSignal<readonly string[]>(['task-1']);
    const dispose = createRoot((dispose) => {
      observeProjectTaskChanges(() => graphql.client, {
        projectId: () => 'project',
        taskIds,
        refresh,
      });
      return dispose;
    });
    try {
      await revalidateActivityQueries(graphql.client, new Set(['unrelated']));
      expect(refresh).not.toHaveBeenCalled();
      await revalidateActivityQueries(graphql.client, new Set(['task-1']));
      await revalidateActivityQueries(graphql.client, new Set(['project']));
      await revalidateActivityQueries(graphql.client, null);
      expect(refresh).toHaveBeenCalledTimes(3);

      setTaskIds(['task-2']);
      await revalidateActivityQueries(graphql.client, new Set(['task-1']));
      expect(refresh).toHaveBeenCalledTimes(3);
      await revalidateActivityQueries(graphql.client, new Set(['task-2']));
      expect(refresh).toHaveBeenCalledTimes(4);

      setTaskIds([]);
      await revalidateActivityQueries(graphql.client, null);
      expect(refresh).toHaveBeenCalledTimes(4);
      setTaskIds(['task-2']);
      dispose();
      await revalidateActivityQueries(graphql.client, null);
      expect(refresh).toHaveBeenCalledTimes(4);
    } finally {
      dispose();
    }
  });
});
