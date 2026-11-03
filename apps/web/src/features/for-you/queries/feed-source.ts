import { FREE_DEFAULT_MODEL } from '@core/component/AI/constant';
import { fireAndForget } from '@core/util/fireAndForget';
import { contentHash } from '@core/util/hash';
import { Telemetry } from '@macro-inc/observability';
import { createAIProjection } from '@queries/ai/projection';
import {
  type Accessor,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { z } from 'zod';
import type { FeedSource } from '../context/feed-source';
import { buildFeedPrompt, feedSchema } from '../core/feed';

/** The existing authenticated projection service materializes this account's feed. */
export function createFeedSource(
  userId: string,
  preferences: Accessor<string>
): FeedSource {
  const outputSchema = z.toJSONSchema(feedSchema, { target: 'draft-07' });
  const [key, { refetch }] = createResource(preferences, async (preference) =>
    contentHash(
      new TextEncoder().encode(
        JSON.stringify({
          userId,
          prompt: buildFeedPrompt(preference),
          model: FREE_DEFAULT_MODEL,
          outputSchema,
        })
      )
    )
  );
  const projectionId = createMemo(() =>
    key.loading || key.error || !key() ? undefined : `for-you/v1/${key()}`
  );
  const projection = createAIProjection(() => ({
    id: projectionId() ?? '',
    prompt: buildFeedPrompt(preferences()),
    schema: feedSchema,
    model: FREE_DEFAULT_MODEL,
    awaitGeneration: true,
    refreshCadence: 'medium',
    expiry: 'week',
    enabled: Boolean(projectionId()),
  }));
  const items = () => {
    const value = projection.data();
    return typeof value === 'object' ? value.items : undefined;
  };
  const [timedOut, setTimedOut] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  const generating = createMemo(() => {
    const manual = refreshing();
    return projection.isGenerating() || manual;
  });
  createEffect(
    on(
      () => [generating(), attempt(), projectionId()] as const,
      ([pending, , id]) => {
        setTimedOut(false);
        if (!pending || !id) return;
        // Gateway delivery can be interrupted. Read the same materialization
        // while waiting; this never requests a new generation.
        const poll = setInterval(() => {
          if (!refreshing() && !projection.query.isFetching) {
            fireAndForget(projection.query.refetch(), 'for-you');
          }
        }, 10_000);
        const timer = setTimeout(() => {
          clearInterval(poll);
          setTimedOut(true);
        }, 90_000);
        onCleanup(() => {
          clearTimeout(timer);
          clearInterval(poll);
        });
      }
    )
  );
  return {
    items,
    loading: () =>
      key.loading || (items() === undefined && generating() && !timedOut()),
    refreshing: () => items() !== undefined && generating() && !timedOut(),
    error: () =>
      (key.error ? 'configuration_error' : undefined) ??
      projection.error() ??
      (timedOut() ? 'generation_timeout' : undefined),
    canRetry: () => !key.loading && !refreshing() && !projection.isForbidden(),
    refresh: async () => {
      if (refreshing() || key.loading) return;
      setRefreshing(true);
      setAttempt((current) => current + 1);
      try {
        await Telemetry.span('for_you.refresh', async (span) => {
          span.setAttr('projection.id', projectionId() ?? '');
          if (key.error) {
            await refetch();
            return;
          }
          await projection.refresh();
        });
      } finally {
        setRefreshing(false);
      }
    },
  };
}
